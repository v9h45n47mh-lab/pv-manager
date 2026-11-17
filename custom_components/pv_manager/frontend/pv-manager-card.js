import {UI_CSS,UI_VERSION,navigation,section,row,field,selectField,combobox,toggle,button,notice,versionInfo,bindUI,energyFlow,seriesChart,bindSeriesCharts,dateNavigation,escapeHtml} from './family-ui/1.9.4/family-ui.js';
import {DEFAULTS,FIELDS,liveValues,allocateFlows,dayKey,periodRange,shiftAnchor,HISTORY_INTERVALS,calendarBuckets,historyPoints,energyFromPower} from './data.js';
const uniqueId=()=>globalThis.crypto?.randomUUID?.()||'pv_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
const VERSION='1.0.6',PERIODS=[{value:'day',label:'Tag'},{value:'week',label:'Woche'},{value:'month',label:'Monat'},{value:'year',label:'Jahr'}];
const ENERGY_METRICS = {
  solar_energy: {label: 'Erzeugung', role: 'solar', powerSuffix: 'power', counterSuffix: 'pv_generation'},
  home_energy: {label: 'Verbrauch', role: 'home', powerSuffix: 'load_power', counterSuffix: 'load_consumption'},
  import_energy: {label: 'Netzbezug', role: 'grid', powerSuffix: 'grid_power', counterSuffix: 'energy_bought'},
};
const hasValues = points => points?.some(point => point.y !== null);
const powerUnits = new Set(['W', 'kW', 'MW']);
const energyUnits = new Set(['Wh', 'kWh', 'MWh']);
function energyCounterIds(configuredId, powerId, {powerSuffix, counterSuffix}, states) {
  if (configuredId) return [configuredId];
  if (!powerId?.endsWith('_' + powerSuffix)) return [];
  const prefix = powerId.slice(0, -powerSuffix.length);
  return ['total', 'daily'].map(kind => prefix + kind + '_' + counterSuffix).filter(id => {
    const attributes = states[id]?.attributes;
    return energyUnits.has(attributes?.unit_of_measurement) && ['total', 'total_increasing'].includes(attributes.state_class);
  });
}
const n=(v,d=1)=>v===null||v===undefined?'—':Number(v).toLocaleString('de-DE',{maximumFractionDigits:d});
const watts=v=>v===null?'—':Math.abs(v)>=1000?n(Math.abs(v)/1000,2)+' kW':n(Math.abs(v),0)+' W';
class PVManagerCard extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this.page='live';this.period='day';this._data={};this._sequence=0;this._hiddenSeries=new Set();}
  static getStubConfig(){return {card_id:uniqueId(),title:'PV-Anlage'};}
  static getConfigElement(){return document.createElement('pv-manager-card-editor');}
  setConfig(config){
    const cardId = config.card_id || 'default';
    if (this.config?.card_id !== cardId) this._hiddenSeries.clear();
    this.config={...DEFAULTS,...config,card_id:cardId};this._settings={};this._ready=false;this._sequence++;this._data={};if(this._hass)this._init();this.render();
  }
  get settings(){return {...this.config,...this._settings};}
  get timezone(){return this._hass?.config?.time_zone||'Europe/Berlin';}
  get today(){return dayKey(new Date(),this.timezone);}
  set hass(hass){this._hass=hass;if(!this.config)return;if(!this._ready){this._init();return;}if(this.page==='live')this._updateLive();}
  connectedCallback(){this._unbind||=bindUI(this.shadowRoot,e=>this._action(e));this._charts||=bindSeriesCharts(this.shadowRoot);this._change||=(e=>this._onChange(e));this.shadowRoot.addEventListener('change',this._change);this._timer||=setInterval(()=>{if(this._ready&&this.page==='history')this._fetch();},60000);this.render();if(this._hass&&!this._ready)this._init();}
  disconnectedCallback(){this._unbind?.();this._unbind=null;this._charts?.();this._charts=null;this.shadowRoot.removeEventListener('change',this._change);clearInterval(this._timer);this._timer=null;this._sequence++;}
  getCardSize(){return this.page==='history'?15:8;}
  getGridOptions(){return {columns:12,rows:'auto',min_columns:6};}
  async _init(){if(this._initializing||!this.config)return;this._initializing=true;const id=this.config.card_id;try{const r=await this._hass.callWS({type:'pv_manager/config',card_id:id});if(id!==this.config.card_id)return;this._settings=r.settings||{};this._admin=r.admin;this._ready=true;this._error=null;this.render();if(this.page==='history')await this._fetch();}catch(e){this._error='PV Manager unter Einstellungen → Geräte & Dienste hinzufügen. '+(e.message||'');this.render();}finally{this._initializing=false;}}
  _range(){return periodRange(this.period,this.anchor||this.today,this.timezone);}
  async _fetch(){
    if (!this._ready) return;
    const request = ++this._sequence;
    const settings = this.settings;
    const range = this._range();
    const period = this.period;
    const now = Date.now();
    const states = this._hass.states || {};
    const sources = Object.entries(ENERGY_METRICS).map(([id, metric]) => {
      const powerId = settings[metric.role];
      return {
        id, metric, powerId,
        counterIds: energyCounterIds(settings[id], powerId, metric, states),
        hasPower: powerUnits.has(states[powerId]?.attributes?.unit_of_measurement),
      };
    });
    const errors = new Set();
    const query = async (ids, recorderPeriod, type, units, start = range.start) => {
      if (!ids.length || range.start >= now) return {};
      try {
        return await this._hass.callWS({
          type: 'recorder/statistics_during_period',
          start_time: new Date(start).toISOString(),
          // Recorder day/month requests round the end up to their calendar boundary.
          end_time: new Date(Math.min(range.end - 1, now)).toISOString(),
          statistic_ids: [...new Set(ids)],
          period: recorderPeriod,
          types: [type],
          units,
        }) || {};
      } catch (error) {
        errors.add(error?.message || 'Abfrage fehlgeschlagen');
        return {};
      }
    };
    this._busy = true;
    this._historyError = null;
    this._data = {};
    this.render();
    try {
      const buckets = period === 'day' ? [] : calendarBuckets(period, range, this.timezone, now);
      const energy = await query(sources.flatMap(source => source.counterIds), HISTORY_INTERVALS[period].recorder, 'change', {energy: 'kWh'});
      if (request !== this._sequence) return;
      const data = {};
      for (const {id, counterIds} of sources) {
        for (const counterId of counterIds) {
          const points = historyPoints(energy[counterId], {period, range, buckets, now, field: 'change'});
          if (hasValues(points)) {
            data[id] = {points};
            break;
          }
        }
      }
      const needsPower = sources.filter(source => !data[source.id] && source.hasPower);
      if (needsPower.length) {
        const end = Math.min(range.end, now);
        const interval = period === 'day' ? 300000 : 3600000;
        const power = await query(needsPower.map(source => source.powerId), period === 'day' ? '5minute' : 'hour', 'mean', {power: 'W'}, Math.floor(range.start / interval) * interval);
        if (request !== this._sequence) return;
        const powerBuckets = period === 'day' ? historyPoints([], {period, range, now}).map(point => point.x) : buckets;
        for (const {id, metric, powerId} of needsPower) {
          const sign = metric.role === 'grid' && settings.grid_positive === 'export' ? -1 : 1;
          const points = energyFromPower(power[powerId], {buckets: powerBuckets, end, sign});
          if (hasValues(points)) data[id] = {points, estimated: true};
        }
      }
      this._data = data;
    } catch (error) {
      errors.add(error?.message || 'Abfrage fehlgeschlagen');
    } finally {
      if (request === this._sequence) {
        this._historyError = [...errors].join(' · ');
        this._busy = false;
        this.render();
      }
    }
  }
  _updateLive(){const live=this.shadowRoot.querySelector('[data-live]');if(live)live.innerHTML=this._live();}
  _live(){
    const s=this.settings,v=liveValues(this._hass?.states||{},s),hasBattery=Boolean(s.battery||s.soc),a=allocateFlows(v,Boolean(s.battery));
    const nodes=[{id:'solar',label:'PV',value:watts(v.solar)},{id:'grid',label:'Netz',value:watts(v.grid),detail:v.grid===null?'':v.grid>=0?'Bezug →':'← Einspeisung'},{id:'home',label:'Haus',value:watts(v.home)}];
    if(hasBattery)nodes.push({id:'battery',label:'Batterie',value:watts(v.battery),badge:v.soc===null?'':n(v.soc,0)+' %',detail:v.battery===null?'':v.battery>=0?'Entladen ↑':'↓ Laden'});
    const missing=['solar','grid','home',...(s.battery?['battery']:[])].filter(k=>v[k]===null);
    return energyFlow({nodes,flows:a.flows,animated:s.animated})+(missing.length?notice('Messwerte fehlen: '+missing.map(k=>FIELDS[k][0]).join(', ')+'. Sensoren und Einheiten in den Einstellungen prüfen.'):'')+(a.difference!==null&&Math.abs(a.difference)>Math.max(100,(v.home||0)*.05)?notice('Leistungsbilanz weicht um '+watts(a.difference)+' ab. Sensorzuordnung und Vorzeichen prüfen. Die Verbindungslinien zeigen rechnerisch zugeordnete Flüsse.'):'');
  }
  _energyChart() {
    const dateOptions = {
      day: {hour: '2-digit', minute: '2-digit'},
      week: {day: '2-digit', month: '2-digit'},
      month: {day: '2-digit', month: '2-digit'},
      year: {month: 'short'},
    };
    const formatter = new Intl.DateTimeFormat('de-DE', {
      timeZone: this.timezone,
      ...dateOptions[this.period],
    });
    const series = Object.entries(ENERGY_METRICS).map(([id, metric]) => {
      const points = this._data[id]?.points || [];
      const values = points.filter(point => point.y !== null);
      return {
        id,
        ...metric,
        points,
        hidden: this._hiddenSeries.has(id),
        legendValue: values.length ? n(values.reduce((sum, point) => sum + point.y, 0), 2) + ' kWh' : '—',
      };
    });
    return seriesChart({
      id: 'energy-chart',
      title: 'Energieverlauf',
      unit: 'kWh',
      series,
      kind: 'bar',
      integerTicks: true,
      legendAction: 'toggle-energy-series',
      legendLabel: 'Kennzahlen und Summen im Zeitraum',
      width: Math.max(280, Math.min(700, (this.clientWidth || 732) - 32)),
      formatX: timestamp => formatter.format(timestamp),
    });
  }
  _history(){
    const r=this._range();
    const metrics = Object.entries(ENERGY_METRICS);
    const missing = metrics.filter(([id]) => !this._data[id]).map(([, metric]) => metric.label);
    const estimated = metrics.filter(([id]) => this._data[id]?.estimated).map(([, metric]) => metric.label);
    return `<div class="toolbar">${selectField({id:'period',label:'Zeitraum',value:this.period,options:PERIODS})}</div>`+
      dateNavigation({label:this.period==='day'?r.first:r.first+' – '+shiftAnchor('day',r.last,-1),previousLabel:'Vorheriger Zeitraum',nextLabel:'Nächster Zeitraum',nextDisabled:r.end>Date.now(),todayLabel:'Heute'})+
      (this._busy?notice('Historische Werte werden geladen …'):'')+
      (this._historyError ? notice('Energieverlauf: ' + this._historyError, {error: true}) : '')+
      `<div id="energy-chart-content">${this._energyChart()}</div>`+
      `<p class="hint">${HISTORY_INTERVALS[this.period].label}. Die Legende zeigt die erfassten Summen im Zeitraum.</p>`+
      (estimated.length ? notice('Aus Leistungsstatistiken geschätzt: ' + estimated.join(', ') + '.') : '') +
      (this._ready && !this._busy && missing.length ? notice('Keine Recorder-Daten für ' + missing.join(', ') + '. Energiezähler in den Einstellungen und den gewählten Zeitraum prüfen.') : '');
  }
  _settingsPage(){const s=this._draft||this.settings,states=this._hass?.states||{};
    const sensors=kind=>Object.entries(states).filter(([id,v])=>id.startsWith('sensor.')&&(kind==='power'?powerUnits.has(v.attributes.unit_of_measurement):kind==='energy'?energyUnits.has(v.attributes.unit_of_measurement):v.attributes.unit_of_measurement==='%')).map(([value,v])=>({value,label:v.attributes.friendly_name||value,description:value})).sort((a,b)=>a.label.localeCompare(b.label,'de'));
    const sensorField=k=>{const [defaultLabel,kind]=FIELDS[k],label=ENERGY_METRICS[k]?.label??defaultLabel,entity=s[k]||'',emptyLabel=kind==='energy'?'Automatisch':'Nicht verwenden';return combobox({id:'sensor-'+k,label,items:[{value:'',label:emptyLabel},...sensors(kind)],selected:entity,value:entity?(states[entity]?.attributes.friendly_name||entity):emptyLabel,action:'sensor-select',disabled:!this._admin});};
    return (!this._admin?notice('Die Einstellungen kann ein Home-Assistant-Administrator ändern.'):'')+section({id:'general',title:'Darstellung',content:field({id:'title',label:'Name der Karte',value:s.title,disabled:!this._admin})+row({title:'Energiefluss animieren',trailing:toggle({label:'Animation',action:'animation',checked:s.animated,disabled:!this._admin})})})+section({id:'power-sensors',title:'Leistung und Batterie',content:['solar','grid','home','battery','soc'].map(sensorField).join('')+selectField({id:'grid-positive',label:'Positiver Netzwert bedeutet',value:s.grid_positive,disabled:!this._admin,options:[{value:'import',label:'Netzbezug'},{value:'export',label:'Einspeisung'}]})+selectField({id:'battery-positive',label:'Positiver Batteriewert bedeutet',value:s.battery_positive,disabled:!this._admin,options:[{value:'discharge',label:'Entladen'},{value:'charge',label:'Laden'}]})})+section({id:'energy-sensors',title:'Energiezähler (optional)',expanded:false,content:notice('Die Karte erkennt passende Sofar-Zähler automatisch. Hier kannst du eigene Energiezähler mit Recorder-Statistik zuordnen.')+Object.keys(ENERGY_METRICS).map(sensorField).join('')})+`<div class="page-actions">${button({label:'Speichern',icon:'save',action:'save',variant:'primary',disabled:!this._admin||this._saving})}${button({label:'Verwerfen',action:'discard'})}</div>`+versionInfo({frontend:VERSION,ui:UI_VERSION});}
  render(){if(!this.config)return;const page=this.page;this.shadowRoot.innerHTML=`<style>${UI_CSS}</style><ha-card>${navigation({label:this.settings.title,items:[{id:'live',label:'Energiefluss'},{id:'history',label:'Verlauf'}],active:page,actions:[{icon:'refresh',label:'Aktualisieren',action:'refresh',disabled:this._busy}]})}<main><div class="page-actions"><h3>${escapeHtml(this.settings.title)}</h3></div>${this._error?notice(this._error,{error:true}):''}${this._message?notice(this._message):''}${page==='settings'?this._settingsPage():page==='history'?this._history():page==='help'?this._help():`<div data-live>${this._live()}</div>`}</main></ha-card>`;}
  _help(){return section({id:'help-content',title:'PV Manager einrichten',content:'<p>In den Einstellungen PV-Leistung, Netzleistung und Hausverbrauch zuordnen. Batterie und Ladezustand sind optional. Die bekannten Sofar-Entitäten sind vorbelegt.</p><p>Netz und Batterie können je nach Wechselrichter unterschiedliche Vorzeichen verwenden. Bei Einspeisung beziehungsweise Laden die Richtungsanzeige prüfen und das Vorzeichen bei Bedarf umstellen.</p><p>Unter Energiezähler kannst du die Zähler für Erzeugung, Verbrauch und Netzbezug zuordnen. Ohne Zählerstatistik schätzt die Karte die kWh aus den erfassten Leistungswerten. Die Legende zeigt ihre Summen und blendet Reihen ein oder aus. Im Diagramm lassen sich Werte je Intervall mit Maus, Finger oder Pfeiltasten ansehen.</p><p>Mehrere Karten sind mit unterschiedlichen card_id-Werten unabhängig konfigurierbar. Einstellungen werden zentral gespeichert; Änderungen sind Administratoren vorbehalten.</p>'});}
  _onChange(e){if(e.target.id==='period'){this.period=e.target.value;this.anchor=null;this._fetch();return;}const key={title:'title','grid-positive':'grid_positive','battery-positive':'battery_positive'}[e.target.id];if(!this._admin||!key)return;this._draft||={...this.settings};this._draft[key]=e.target.value;}
  async _action({action,data,value,element}){
    if(action==='navigate'){this.page=data.page;this._message=null;this.render();if(this.page==='history')this._fetch();return;}
    if(action==='energy-node'){const entity=this.settings[{solar:'solar',grid:'grid',home:'home',battery:'battery'}[data.node]]||this.settings.soc;if(entity)this.dispatchEvent(new CustomEvent('hass-more-info',{detail:{entityId:entity},bubbles:true,composed:true}));return;}
    if(['previous-period','next-period','today'].includes(action)){this.anchor=action==='today'?this.today:shiftAnchor(this.period,this.anchor||this.today,action==='previous-period'?-1:1);this._fetch();return;}
    if(action==='refresh'){if(!this._ready)this._init();else if(this.page==='history')this._fetch();else this._updateLive();return;}
    if(action==='discard'){this._draft=null;this._message=null;this.render();return;}
    if (action === 'toggle-energy-series' && Object.hasOwn(ENERGY_METRICS, data.series)) {
      if (this._hiddenSeries.has(data.series)) this._hiddenSeries.delete(data.series);
      else this._hiddenSeries.add(data.series);
      const container = this.shadowRoot.getElementById('energy-chart-content');
      container.innerHTML = this._energyChart();
      container.querySelector(`[data-series="${data.series}"]`)?.focus({preventScroll: true});
      return;
    }
    if(!this._admin)return;
    if(action==='sensor-select'){this._draft||={...this.settings};const key=element?.id.replace(/^sensor-/, '').replace(/-control$/, '');if(FIELDS[key])this._draft[key]=value;return;}
    if(action==='animation'){this._draft||={...this.settings};this._draft.animated=!this._draft.animated;this.render();return;}
    if(action==='save'){this._saving=true;this._message=null;try{const draft=this._draft||this.settings;const settings=Object.fromEntries(Object.entries(draft).filter(([key])=>['title','animated','grid_positive','battery_positive',...Object.keys(FIELDS)].includes(key)));await this._hass.callWS({type:'pv_manager/save',card_id:this.config.card_id,settings});this._settings={...settings};this._draft=null;this._data={};this._message='Einstellungen gespeichert.';this._error=null;}catch(e){this._error='Speichern fehlgeschlagen: '+(e.message||'Unbekannter Fehler');}finally{this._saving=false;this.render();}}
  }
}
class PVManagerEditor extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});}
  setConfig(config){this.config={...config,card_id:config.card_id||uniqueId()};this.render();}
  render(){this.shadowRoot.innerHTML=`<style>${UI_CSS}</style>${field({id:'card-id',label:'Karten-ID',value:this.config.card_id,hint:'Für unabhängige Einstellungen pro Karte eine eigene ID verwenden.'})}${field({id:'card-title',label:'Name der Karte',value:this.config.title||'PV-Anlage'})}`;this.shadowRoot.onchange=()=>{this.config={...this.config,card_id:this.shadowRoot.getElementById('card-id').value,title:this.shadowRoot.getElementById('card-title').value};this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:this.config},bubbles:true,composed:true}));};}
}
if(!customElements.get('pv-manager-card'))customElements.define('pv-manager-card',PVManagerCard);
if(!customElements.get('pv-manager-card-editor'))customElements.define('pv-manager-card-editor',PVManagerEditor);
window.customCards=window.customCards||[];window.customCards.push({type:'pv-manager-card',name:'PV Manager',description:'PV-Energiefluss und summierter Energieverlauf',preview:true});
