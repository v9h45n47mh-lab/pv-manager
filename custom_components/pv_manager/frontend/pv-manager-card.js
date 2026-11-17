import {UI_CSS,UI_VERSION,navigation,section,row,field,selectField,combobox,toggle,button,notice,versionInfo,bindUI,energyFlow,seriesChart,bindSeriesCharts,dateNavigation,sensorOverview,escapeHtml,checkboxGroup} from './family-ui/1.9.2/family-ui.js';
import {DEFAULTS,FIELDS,liveValues,allocateFlows,dayKey,periodRange,shiftAnchor,HISTORY_INTERVALS,calendarBuckets,historyPoints} from './data.js';
const uniqueId=()=>globalThis.crypto?.randomUUID?.()||'pv_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
const VERSION='1.0.4',PERIODS=[{value:'day',label:'Tag'},{value:'week',label:'Woche'},{value:'month',label:'Monat'},{value:'year',label:'Jahr'}];
const ENERGY_ROLES = {
  solar_energy: 'solar',
  import_energy: 'grid',
  export_energy: 'export',
  home_energy: 'home',
  charge_energy: 'charge',
  discharge_energy: 'battery',
};
const POWER_LABELS = {
  solar: 'PV-Leistung',
  home: 'Hausleistung',
  grid: 'Netzleistung (+ Bezug / − Einspeisung)',
  battery: 'Batterieleistung (+ Entladen / − Laden)',
};
const HISTORY_CHARTS = {
  power: {title: 'Leistungsverlauf', unit: 'W', filterLabel: 'Leistung anzeigen'},
  soc: {title: 'Batterie-Ladezustand', unit: '%', filterLabel: 'Batterie anzeigen', min: 0, max: 100},
  energy: {title: 'Energieverlauf', unit: 'kWh', filterLabel: 'Balken anzeigen'},
};
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
    if(!this._ready)return;
    const request=++this._sequence,s=this.settings,r=this._range();
    const period = HISTORY_INTERVALS[this.period].recorder;
    // Recorder day/month requests round the end up to the end of its calendar bucket.
    const end = Math.min(r.end - 1, Date.now());
    this._busy=true;this._errors=[];this._data={};this.render();
    const ids=keys=>[...new Set(keys.map(k=>s[k]).filter(Boolean))];
    const query=async(entities,types,units)=>entities.length?this._hass.callWS({type:'recorder/statistics_during_period',start_time:new Date(r.start).toISOString(),end_time:new Date(end).toISOString(),statistic_ids:entities,period,types,units}):{};
    const powerIds=ids(Object.keys(POWER_LABELS)),socIds=ids(['soc']),energyIds=ids(Object.keys(ENERGY_ROLES));
    const requests=await Promise.allSettled([query(powerIds,['mean'],{power:'W'}),query(socIds,['mean'],{}),query(energyIds,['change'],{energy:'kWh'})]);
    if(request!==this._sequence)return;
    ['power','soc','energy'].forEach((key,i)=>{if(requests[i].status==='fulfilled')this._data[key]=requests[i].value;else this._errors.push(({power:'Leistungsverlauf',soc:'Batterieverlauf',energy:'Energieverlauf'}[key])+': '+(requests[i].reason?.message||'Abfrage fehlgeschlagen'));});
    this._busy=false;this.render();
  }
  _updateLive(){const live=this.shadowRoot.querySelector('[data-live]');if(live)live.innerHTML=this._live();}
  _live(){
    const s=this.settings,v=liveValues(this._hass?.states||{},s),hasBattery=Boolean(s.battery||s.soc),a=allocateFlows(v,Boolean(s.battery));
    const nodes=[{id:'solar',label:'PV',value:watts(v.solar)},{id:'grid',label:'Netz',value:watts(v.grid),detail:v.grid===null?'':v.grid>=0?'Bezug →':'← Einspeisung'},{id:'home',label:'Haus',value:watts(v.home)}];
    if(hasBattery)nodes.push({id:'battery',label:'Batterie',value:watts(v.battery),badge:v.soc===null?'':n(v.soc,0)+' %',detail:v.battery===null?'':v.battery>=0?'Entladen ↑':'↓ Laden'});
    const missing=['solar','grid','home',...(s.battery?['battery']:[])].filter(k=>v[k]===null);
    return energyFlow({nodes,flows:a.flows,animated:s.animated})+(missing.length?notice('Messwerte fehlen: '+missing.map(k=>FIELDS[k][0]).join(', ')+'. Sensoren und Einheiten in den Einstellungen prüfen.'):'')+(a.difference!==null&&Math.abs(a.difference)>Math.max(100,(v.home||0)*.05)?notice('Leistungsbilanz weicht um '+watts(a.difference)+' ab. Sensorzuordnung und Vorzeichen prüfen. Die Verbindungslinien zeigen rechnerisch zugeordnete Flüsse.'):'');
  }
  _chart(options) {
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
    return seriesChart({
      width: Math.max(280, Math.min(700, (this.clientWidth || 732) - 32)),
      formatX: timestamp => formatter.format(timestamp),
      ...options,
      kind: 'bar',
    });
  }
  _historySeries(group, range = this._range()) {
    const settings = this.settings;
    const period = this.period;
    const now = Date.now();
    const buckets = period === 'day' ? [] : calendarBuckets(period, range, this.timezone, now);
    const metricIds = group === 'power' ? Object.keys(POWER_LABELS) :
      group === 'energy' ? Object.keys(ENERGY_ROLES) : ['soc'];
    return metricIds.filter(id => settings[id]).map(id => {
      const reversed = (id === 'grid' && settings.grid_positive === 'export') ||
        (id === 'battery' && settings.battery_positive === 'charge');
      return {
        id,
        role: ENERGY_ROLES[id] ?? (id === 'soc' ? 'battery' : id),
        label: POWER_LABELS[id] ?? (id === 'soc' ? 'Ladezustand' : FIELDS[id][0]),
        points: historyPoints(this._data[group]?.[settings[id]], {
          period, range, buckets, now,
          field: group === 'energy' ? 'change' : 'mean',
          sign: reversed ? -1 : 1,
        }),
      };
    });
  }
  _visibleHistoryChart(group, series) {
    const visible = series.filter(item => !this._hiddenSeries.has(item.id));
    if (!visible.length) return notice('Wähle mindestens eine Kennzahl für dieses Diagramm aus.');
    const {title, unit, min, max} = HISTORY_CHARTS[group];
    return this._chart({
      id: group + '-chart', title, series: visible, unit, min, max,
      ...(group === 'power' ? {formatValue: value => n(value, 0)} : {}),
    });
  }
  _filteredHistory(group, series) {
    if (!series.length) return group === 'energy'
      ? notice('Für den Energieverlauf bitte kWh-Zähler in den Einstellungen auswählen.')
      : '';
    const filters = checkboxGroup({
      id: group + '-series-filter',
      label: HISTORY_CHARTS[group].filterLabel,
      items: series.map(item => ({value: item.id, label: item.label})),
      values: series.filter(item => !this._hiddenSeries.has(item.id)).map(item => item.id),
      action: 'filter-' + group + '-series',
    });
    return `${filters}<div id="${group}-chart-content">${this._visibleHistoryChart(group, series)}</div>`;
  }
  _history(){
    const r=this._range();
    const energySeries = this._historySeries('energy', r);
    const summaries=energySeries.map(series=>{const valid=series.points.filter(p=>p.y!==null);return {label:series.label,value:(valid.length?n(valid.reduce((sum,p)=>sum+p.y,0),2):'—')+' kWh',icon:'energy-'+({export:'grid',charge:'battery'}[series.role]||series.role)};});
    return `<div class="toolbar">${selectField({id:'period',label:'Zeitraum',value:this.period,options:PERIODS})}</div>`+
      dateNavigation({label:this.period==='day'?r.first:r.first+' – '+shiftAnchor('day',r.last,-1),previousLabel:'Vorheriger Zeitraum',nextLabel:'Nächster Zeitraum',nextDisabled:r.end>Date.now(),todayLabel:'Heute'})+
      (this._busy?notice('Historische Werte werden geladen …'):'')+
      (this._errors||[]).map(e=>notice(e,{error:true})).join('')+
      (summaries.length?sensorOverview({id:'energy-summary',title:'Erfasste Energie im Zeitraum',groups:[{title:'',items:summaries}]}):'')+
      `<p class="hint">${HISTORY_INTERVALS[this.period].label}. Leistung und Ladezustand als Mittelwert, Energie als Summe.</p>`+
      this._filteredHistory('power', this._historySeries('power', r))+
      this._filteredHistory('soc', this._historySeries('soc', r))+
      this._filteredHistory('energy', energySeries)+
      (this.period === 'day' ? '<p class="hint">15-Minuten-Werte benötigen verfügbare Kurzzeitstatistiken im Recorder.</p>' : '')+
      `<p class="hint">Historie aus dem Home-Assistant-Recorder. Lücken bedeuten fehlende Statistiken. Energiesummen enthalten nur erfasste Intervalle; das laufende Intervall kann noch fehlen.</p>`;
  }
  _settingsPage(){const s=this._draft||this.settings,states=this._hass?.states||{};
    const sensors=kind=>Object.entries(states).filter(([id,v])=>id.startsWith('sensor.')&&(kind==='power'?['W','kW','MW'].includes(v.attributes.unit_of_measurement):kind==='energy'?['Wh','kWh','MWh'].includes(v.attributes.unit_of_measurement):v.attributes.unit_of_measurement==='%')).map(([value,v])=>({value,label:v.attributes.friendly_name||value,description:value})).sort((a,b)=>a.label.localeCompare(b.label,'de'));
    const sensorField=k=>{const [label,kind]=FIELDS[k],entity=s[k]||'';return combobox({id:'sensor-'+k,label,items:[{value:'',label:'Nicht verwenden'},...sensors(kind)],selected:entity,value:entity?(states[entity]?.attributes.friendly_name||entity):'Nicht verwenden',action:'sensor-select',disabled:!this._admin});};
    return (!this._admin?notice('Die Einstellungen kann ein Home-Assistant-Administrator ändern.'):'')+section({id:'general',title:'Darstellung',content:field({id:'title',label:'Name der Karte',value:s.title,disabled:!this._admin})+row({title:'Energiefluss animieren',trailing:toggle({label:'Animation',action:'animation',checked:s.animated,disabled:!this._admin})})})+section({id:'power-sensors',title:'Leistung und Batterie',content:['solar','grid','home','battery','soc'].map(sensorField).join('')+selectField({id:'grid-positive',label:'Positiver Netzwert bedeutet',value:s.grid_positive,disabled:!this._admin,options:[{value:'import',label:'Netzbezug'},{value:'export',label:'Einspeisung'}]})+selectField({id:'battery-positive',label:'Positiver Batteriewert bedeutet',value:s.battery_positive,disabled:!this._admin,options:[{value:'discharge',label:'Entladen'},{value:'charge',label:'Laden'}]})})+section({id:'energy-sensors',title:'Energiezähler (optional)',expanded:false,content:notice('Kumulierte Energiezähler in Wh, kWh oder MWh mit Langzeitstatistik wählen. Tageszähler benötigen state_class total_increasing oder korrekte Reset-Metadaten.')+Object.keys(FIELDS).filter(k=>k.endsWith('_energy')).map(sensorField).join('')})+`<div class="page-actions">${button({label:'Speichern',icon:'save',action:'save',variant:'primary',disabled:!this._admin||this._saving})}${button({label:'Verwerfen',action:'discard'})}</div>`+versionInfo({frontend:VERSION,ui:UI_VERSION});}
  render(){if(!this.config)return;const page=this.page;this.shadowRoot.innerHTML=`<style>${UI_CSS}</style><ha-card>${navigation({label:this.settings.title,items:[{id:'live',label:'Energiefluss'},{id:'history',label:'Verlauf'}],active:page,actions:[{icon:'refresh',label:'Aktualisieren',action:'refresh',disabled:this._busy}]})}<main><div class="page-actions"><h3>${escapeHtml(this.settings.title)}</h3></div>${this._error?notice(this._error,{error:true}):''}${this._message?notice(this._message):''}${page==='settings'?this._settingsPage():page==='history'?this._history():page==='help'?this._help():`<div data-live>${this._live()}</div>`}</main></ha-card>`;}
  _help(){return section({id:'help-content',title:'PV Manager einrichten',content:'<p>In den Einstellungen PV-Leistung, Netzleistung und Hausverbrauch zuordnen. Batterie und Ladezustand sind optional. Die bekannten Sofar-Entitäten sind vorbelegt.</p><p>Netz und Batterie können je nach Wechselrichter unterschiedliche Vorzeichen verwenden. Bei Einspeisung beziehungsweise Laden die Richtungsanzeige prüfen und das Vorzeichen bei Bedarf umstellen.</p><p>Für Verläufe benötigen Leistungssensoren state_class measurement; Energiezähler total oder total_increasing sowie aktive Recorder-Statistiken. Die Karte speichert keine eigene Messhistorie. Im Diagramm mit Maus, Finger oder Pfeiltasten einzelne Werte ansehen.</p><p>Mehrere Karten sind mit unterschiedlichen card_id-Werten unabhängig konfigurierbar. Einstellungen werden zentral gespeichert; Änderungen sind Administratoren vorbehalten.</p>'});}
  _onChange(e){if(e.target.id==='period'){this.period=e.target.value;this.anchor=null;this._fetch();return;}const key={title:'title','grid-positive':'grid_positive','battery-positive':'battery_positive'}[e.target.id];if(!this._admin||!key)return;this._draft||={...this.settings};this._draft[key]=e.target.value;}
  async _action({action,data,value,element}){
    if(action==='navigate'){this.page=data.page;this._message=null;this.render();if(this.page==='history')this._fetch();return;}
    if(action==='energy-node'){const entity=this.settings[{solar:'solar',grid:'grid',home:'home',battery:'battery'}[data.node]]||this.settings.soc;if(entity)this.dispatchEvent(new CustomEvent('hass-more-info',{detail:{entityId:entity},bubbles:true,composed:true}));return;}
    if(['previous-period','next-period','today'].includes(action)){this.anchor=action==='today'?this.today:shiftAnchor(this.period,this.anchor||this.today,action==='previous-period'?-1:1);this._fetch();return;}
    if(action==='refresh'){if(!this._ready)this._init();else if(this.page==='history')this._fetch();else this._updateLive();return;}
    if(action==='discard'){this._draft=null;this._message=null;this.render();return;}
    const group = /^filter-(power|soc|energy)-series$/.exec(action)?.[1];
    if (group) {
      const series = this._historySeries(group);
      const selected = new Set(value);
      for (const item of series) {
        if (selected.has(item.id)) this._hiddenSeries.delete(item.id);
        else this._hiddenSeries.add(item.id);
      }
      this.shadowRoot.getElementById(group + '-chart-content').innerHTML = this._visibleHistoryChart(group, series);
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
window.customCards=window.customCards||[];window.customCards.push({type:'pv-manager-card',name:'PV Manager',description:'PV-Energiefluss und historische Leistung, Batterie und Energie',preview:true});
