import {UI_CSS,UI_VERSION,navigation,section,row,field,selectField,combobox,toggle,button,filterButton,notice,versionInfo,bindUI,energyFlow,seriesChart,bindSeriesCharts,dateNavigation,escapeHtml} from './family-ui/1.9.6/family-ui.js';
import {DEFAULTS,FIELDS,liveValues,allocateFlows,dayKey,historyRange,validCustomRange,shiftAnchor,HISTORY_INTERVALS,HOUR,QUARTER_HOUR,calendarBuckets,historyPoints,energyFromPower} from './data.js?v=1.0.11';
const uniqueId=()=>globalThis.crypto?.randomUUID?.()||'pv_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
const VERSION = '1.0.11';
const PERIODS = {
  day: {label: 'Tag', previous: 'Vorheriger Tag', next: 'Nächster Tag'},
  week: {label: 'Woche', previous: 'Vorherige Woche', next: 'Nächste Woche'},
  month: {label: 'Monat', previous: 'Vorheriger Monat', next: 'Nächster Monat'},
  year: {label: 'Jahr', previous: 'Vorheriges Jahr', next: 'Nächstes Jahr'},
  custom: {label: 'Zeitraum'},
};
const ENERGY_METRICS = {
  solar_energy: {label: 'Erzeugung', role: 'solar', powerSuffixes: ['pv_power', 'power'],
    counterSuffixes: ['today_production', 'total_production', 'total_pv_generation', 'daily_pv_generation']},
  home_energy: {label: 'Verbrauch', role: 'home', powerSuffixes: ['load_power'],
    counterSuffixes: ['today_load_consumption', 'total_load_consumption', 'daily_load_consumption']},
  import_energy: {label: 'Netzbezug', role: 'grid', powerSuffixes: ['grid_power'],
    counterSuffixes: ['today_energy_import', 'total_energy_import', 'total_energy_bought', 'daily_energy_bought']},
};
const hasValues = points => points?.some(point => point.y !== null);
const powerUnits = new Set(['W', 'kW', 'MW']);
const energyUnits = new Set(['Wh', 'kWh', 'MWh']);
function energyCounterIds(configuredId, powerId, {powerSuffixes, counterSuffixes}) {
  if (configuredId) return [configuredId];
  const suffix = powerSuffixes.find(suffix => powerId?.endsWith('_' + suffix));
  if (!suffix) return [];
  const prefix = powerId.slice(0, -suffix.length);
  // Imported statistics can remain in Recorder without a matching live entity.
  return counterSuffixes.map(suffix => prefix + suffix);
}
const n=(v,d=1)=>v===null||v===undefined?'—':Number(v).toLocaleString('de-DE',{maximumFractionDigits:d});
const watts=v=>v===null?'—':Math.abs(v)>=1000?n(Math.abs(v)/1000,2)+' kW':n(Math.abs(v),0)+' W';

function updateFlowPaths(svg, nextSvg) {
  const key = path => path.getAttribute('d') + ':' + path.classList.contains('fui-flow-track');
  const existing = new Map([...svg.children].map(path => [key(path), path]));
  let cursor = svg.firstElementChild;
  for (const next of [...nextSvg.children]) {
    const id = key(next);
    const path = existing.get(id);
    if (!path) {
      svg.insertBefore(next, cursor);
      continue;
    }
    // Keep the connected SVG path so its animation timeline survives data updates.
    for (const name of ['class', 'style', 'pathLength']) {
      const value = next.getAttribute(name);
      if (path.getAttribute(name) === value) continue;
      if (value === null) path.removeAttribute(name);
      else path.setAttribute(name, value);
    }
    existing.delete(id);
    cursor = path.nextElementSibling;
  }
  for (const path of existing.values()) path.remove();
}

class PVManagerCard extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this.page='live';this.period='day';this._anchors={};this._data={};this._sequence=0;this._hiddenSeries=new Set();}
  static getStubConfig(){return {card_id:uniqueId(),title:'PV-Anlage'};}
  static getConfigElement(){return document.createElement('pv-manager-card-editor');}
  setConfig(config){
    const cardId = config.card_id || 'default';
    if (this.config?.card_id !== cardId) {
      this._hiddenSeries.clear();
      this._anchors = {};
      this._custom = this._customDraft = null;
      this._periodError = null;
    }
    this.config={...DEFAULTS,...config,card_id:cardId};this._settings={};this._ready=false;this._sequence++;this._data={};if(this._hass)this._init();this.render();
  }
  get settings(){return {...this.config,...this._settings};}
  get timezone(){return this._hass?.config?.time_zone||'Europe/Berlin';}
  get today(){return dayKey(new Date(),this.timezone);}
  set hass(hass){this._hass=hass;if(!this.config)return;if(!this._ready){this._init();return;}if(this.page==='live')this._updateLive();}
  connectedCallback(){this._unbind||=bindUI(this.shadowRoot,e=>this._action(e));this._charts||=bindSeriesCharts(this.shadowRoot);this._change||=(e=>this._onChange(e));this._periodKey||=(e=>this._navigateWithKey(e));this.shadowRoot.addEventListener('change',this._change);this.shadowRoot.addEventListener('keydown',this._periodKey);this._timer||=setInterval(()=>{if(this._ready&&this.page==='history'&&this.period!=='custom'&&!this._anchor)this._fetch();},60000);this.render();if(this._hass&&!this._ready)this._init();}
  disconnectedCallback(){this._unbind?.();this._unbind=null;this._charts?.();this._charts=null;this.shadowRoot.removeEventListener('change',this._change);this.shadowRoot.removeEventListener('keydown',this._periodKey);clearInterval(this._timer);this._timer=null;this._sequence++;}
  getCardSize(){return this.page==='history'?15:8;}
  getGridOptions(){return {columns:12,rows:'auto',min_columns:6};}
  async _init(){if(this._initializing||!this.config)return;this._initializing=true;const id=this.config.card_id;try{const r=await this._hass.callWS({type:'pv_manager/config',card_id:id});if(id!==this.config.card_id)return;this._settings=r.settings||{};this._admin=r.admin;this._ready=true;this._error=null;this.render();if(this.page==='history')await this._fetch();}catch(e){this._error='PV Manager unter Einstellungen → Geräte & Dienste hinzufügen. '+(e.message||'');this.render();}finally{this._initializing=false;}}
  get _anchor(){return this._anchors[this.period];}
  _range(now = Date.now()){return historyRange(this.period, this._anchor, this.timezone, now, this._custom);}
  async _fetch(){
    if (!this._ready) return;
    const request = ++this._sequence;
    const settings = this.settings;
    const period = this.period;
    const now = Date.now();
    const range = this._range(now);
    if (!range) return;
    const states = this._hass.states || {};
    const sources = Object.entries(ENERGY_METRICS).map(([id, metric]) => {
      const powerId = settings[metric.role];
      return {
        id, metric, powerId,
        counterIds: energyCounterIds(settings[id], powerId, metric),
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
    this._hourly = false;
    this._data = {};
    this.render();
    try {
      const buckets = period === 'day' ? [] : calendarBuckets(period, range, this.timezone, now);
      const intervalStart = interval => Math.ceil(range.start / interval) * interval;
      const counterIds = sources.flatMap(source => source.counterIds);
      const counterData = (energy, step) => {
        const data = {};
        for (const {id, counterIds} of sources) {
          for (const counterId of counterIds) {
            const points = historyPoints(energy[counterId], {period, range, buckets, now, field: 'change', step});
            if (hasValues(points)) {
              data[id] = {points};
              break;
            }
          }
        }
        return data;
      };
      let step = QUARTER_HOUR;
      let data = counterData(await query(counterIds, HISTORY_INTERVALS[period].recorder, 'change', {energy: 'kWh'},
        period === 'day' ? intervalStart(300000) : range.start), step);
      if (request !== this._sequence) return;
      if (period === 'day' && sources.some(source => source.counterIds.length && !data[source.id])) {
        const hourly = counterData(await query(counterIds, 'hour', 'change', {energy: 'kWh'}, intervalStart(HOUR)), HOUR);
        if (request !== this._sequence) return;
        if (sources.some(({id}) => hourly[id] && !data[id]) && Object.keys(data).every(id => hourly[id])) {
          data = hourly;
          step = HOUR;
        }
      }
      const needsPower = sources.filter(source => !data[source.id] && source.hasPower);
      if (needsPower.length) {
        const end = Math.min(range.end, now);
        const fine = period === 'day' && step === QUARTER_HOUR;
        const interval = fine ? 300000 : HOUR;
        const power = await query(needsPower.map(source => source.powerId), fine ? '5minute' : 'hour', 'mean', {power: 'W'}, Math.floor(range.start / interval) * interval);
        if (request !== this._sequence) return;
        const powerBuckets = period === 'day' ? historyPoints([], {period, range, now, step}).map(point => point.x) : buckets;
        for (const {id, metric, powerId} of needsPower) {
          const sign = metric.role === 'grid' && settings.grid_positive === 'export' ? -1 : 1;
          const points = energyFromPower(power[powerId], {buckets: powerBuckets, start: range.start, end, sign});
          if (hasValues(points)) data[id] = {points, estimated: true};
        }
      }
      this._hourly = period === 'day' && step === HOUR;
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
  _updateLive() {
    const live = this.shadowRoot.querySelector('[data-live]');
    if (!live) return;
    const markup = this._live();
    if (markup === this._liveMarkup) return;
    this._liveMarkup = markup;

    const template = this.ownerDocument.createElement('template');
    template.innerHTML = markup;
    const flow = live.firstElementChild;
    const [nextFlow, ...notices] = template.content.children;
    const [svg, ...nodes] = flow.children;
    const [nextSvg, ...nextNodes] = nextFlow.children;
    updateFlowPaths(svg, nextSvg);

    for (const [index, node] of nodes.entries()) {
      const next = nextNodes[index];
      if (!next) node.remove();
      else if (!node.isEqualNode(next)) node.replaceWith(next);
    }
    flow.append(...nextNodes.slice(nodes.length));
    while (flow.nextElementSibling) flow.nextElementSibling.remove();
    live.append(...notices);
  }
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
      custom: {day: '2-digit', month: '2-digit'},
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
  _periodControls(range, now) {
    const buttons = Object.entries(PERIODS).map(([period, {label}]) =>
      filterButton({label, action: 'select-period', selected: this.period === period, data: {period}}));
    let navigation;
    if (this.period === 'custom') {
      const [from, to] = this._customDraft || this._custom || [this.today, this.today];
      navigation = field({id: 'period-from', label: 'Von', type: 'date', value: from, max: this.today}) +
        field({id: 'period-to', label: 'Bis', type: 'date', value: to, max: this.today}) +
        `<div class="toolbar">${button({label: 'Anzeigen', action: 'apply-period', variant: 'primary'})}</div>` +
        (this._periodError ? notice(this._periodError, {error: true}) : '');
    } else {
      const {previous, next} = PERIODS[this.period];
      navigation = dateNavigation({
        label: this._periodLabel(range), previousLabel: previous, nextLabel: next,
        nextDisabled: !this._anchor, todayLabel: 'Aktuell', todayDisabled: !this._anchor,
      });
    }
    let caption = '';
    if (range) {
      const end = range.end === now ? now : Math.min(range.end - 1, now);
      const format = this.period === 'day' && !this._anchor
        ? new Intl.DateTimeFormat('de-DE', {timeZone: this.timezone, dateStyle: 'short', timeStyle: 'short'})
        : new Intl.DateTimeFormat('de-DE', {timeZone: this.timezone, dateStyle: 'medium'});
      const first = format.format(range.start);
      const last = format.format(end);
      caption = `<p class="hint">${escapeHtml(first === last ? first : first + ' – ' + last)}</p>`;
    }
    return `<div data-period-controls><div class="toolbar" role="group" aria-label="Auswertungszeitraum">${buttons.join('')}</div>${navigation}${caption}</div>`;
  }
  _periodLabel(range) {
    const first = new Date(range.first + 'T12:00:00Z');
    if (this.period === 'day') {
      return this._anchor ? first.toLocaleDateString('de-DE', {timeZone: 'UTC'}) : 'Letzte 24 Stunden';
    }
    if (this.period === 'week') {
      if (!this._anchor) return 'Heute und die letzten 7 Tage';
      first.setUTCDate(first.getUTCDate() + 3);
      const year = first.getUTCFullYear();
      const week = Math.ceil((1 + (first - new Date(year + '-01-01T12:00:00Z')) / 86400000) / 7);
      return `KW ${week} · ${year}`;
    }
    return this.period === 'month'
      ? first.toLocaleDateString('de-DE', {timeZone: 'UTC', month: 'long', year: 'numeric'})
      : String(first.getUTCFullYear());
  }
  _history(){
    const now = Date.now();
    const range = this._range(now);
    const metrics = Object.entries(ENERGY_METRICS);
    const missing = metrics.filter(([id]) => !this._data[id]).map(([, metric]) => metric.label);
    const estimated = metrics.filter(([id]) => this._data[id]?.estimated).map(([, metric]) => metric.label);
    const controls = this._periodControls(range, now);
    if (!range) return controls;
    return controls +
      (this._busy?notice('Historische Werte werden geladen …'):'')+
      (this._historyError ? notice('Energieverlauf: ' + this._historyError, {error: true}) : '')+
      `<div id="energy-chart-content">${this._energyChart()}</div>`+
      `<p class="hint">${this._hourly ? 'Stundenwerte aus der Langzeitstatistik' : HISTORY_INTERVALS[this.period].label}. Die Legende zeigt die erfassten Summen im Zeitraum.</p>`+
      (estimated.length ? notice('Aus Leistungsstatistiken geschätzt: ' + estimated.join(', ') + '.') : '') +
      (this._ready && !this._busy && missing.length ? notice('Keine Recorder-Daten für ' + missing.join(', ') + '. Energiezähler in den Einstellungen und den gewählten Zeitraum prüfen.') : '');
  }
  _settingsPage(){const s=this._draft||this.settings,states=this._hass?.states||{};
    const sensors=kind=>Object.entries(states).filter(([id,v])=>id.startsWith('sensor.')&&(kind==='power'?powerUnits.has(v.attributes.unit_of_measurement):kind==='energy'?energyUnits.has(v.attributes.unit_of_measurement):v.attributes.unit_of_measurement==='%')).map(([value,v])=>({value,label:v.attributes.friendly_name||value,description:value})).sort((a,b)=>a.label.localeCompare(b.label,'de'));
    const sensorField=k=>{const [defaultLabel,kind]=FIELDS[k],label=ENERGY_METRICS[k]?.label??defaultLabel,entity=s[k]||'',emptyLabel=kind==='energy'?'Automatisch':'Nicht verwenden';return combobox({id:'sensor-'+k,label,items:[{value:'',label:emptyLabel},...sensors(kind)],selected:entity,value:entity?(states[entity]?.attributes.friendly_name||entity):emptyLabel,action:'sensor-select',disabled:!this._admin});};
    return (!this._admin?notice('Die Einstellungen kann ein Home-Assistant-Administrator ändern.'):'')+section({id:'general',title:'Darstellung',content:field({id:'title',label:'Name der Karte',value:s.title,disabled:!this._admin})+row({title:'Energiefluss animieren',trailing:toggle({label:'Animation',action:'animation',checked:s.animated,disabled:!this._admin})})})+section({id:'power-sensors',title:'Leistung und Batterie',content:['solar','grid','home','battery','soc'].map(sensorField).join('')+selectField({id:'grid-positive',label:'Positiver Netzwert bedeutet',value:s.grid_positive,disabled:!this._admin,options:[{value:'import',label:'Netzbezug'},{value:'export',label:'Einspeisung'}]})+selectField({id:'battery-positive',label:'Positiver Batteriewert bedeutet',value:s.battery_positive,disabled:!this._admin,options:[{value:'discharge',label:'Entladen'},{value:'charge',label:'Laden'}]})})+section({id:'energy-sensors',title:'Energiezähler (optional)',expanded:false,content:notice('Die Karte erkennt passende Sofar-Tageszähler und importierte Recorder-Statistiken automatisch. Hier kannst du eigene Energiezähler zuordnen.')+Object.keys(ENERGY_METRICS).map(sensorField).join('')})+`<div class="page-actions">${button({label:'Speichern',icon:'save',action:'save',variant:'primary',disabled:!this._admin||this._saving})}${button({label:'Verwerfen',action:'discard'})}</div>`+versionInfo({frontend:VERSION,ui:UI_VERSION});}
  render(){
    if (!this.config) return;
    const active = this.shadowRoot.activeElement;
    const focus = active?.closest('[data-period-controls]') ? active.dataset : null;
    const page = this.page;
    this._liveMarkup = page === 'live' ? this._live() : '';
    this.shadowRoot.innerHTML=`<style>${UI_CSS}</style><ha-card>${navigation({label:this.settings.title,items:[{id:'live',label:'Energiefluss'},{id:'history',label:'Verlauf'}],active:page,actions:[{icon:'refresh',label:'Aktualisieren',action:'refresh',disabled:this._busy}]})}<main><div class="page-actions"><h3>${escapeHtml(this.settings.title)}</h3></div>${this._error?notice(this._error,{error:true}):''}${this._message?notice(this._message):''}${page==='settings'?this._settingsPage():page==='history'?this._history():page==='help'?this._help():`<div data-live>${this._liveMarkup}</div>`}</main></ha-card>`;
    if (focus?.action) {
      const selector = focus.period
        ? `[data-action="select-period"][data-period="${focus.period}"]`
        : `[data-period-controls] [data-action="${focus.action}"]:not([disabled])`;
      const target = this.shadowRoot.querySelector(selector) ||
        this.shadowRoot.querySelector('[data-action="previous-period"]');
      target?.focus({preventScroll: true});
    }
  }
  _help(){return section({id:'help-content',title:'PV Manager einrichten',content:'<p>In den Einstellungen PV-Leistung, Netzleistung und Hausverbrauch zuordnen. Batterie und Ladezustand sind optional. Die bekannten Sofar-Entitäten sind vorbelegt.</p><p>Netz und Batterie können je nach Wechselrichter unterschiedliche Vorzeichen verwenden. Bei Einspeisung beziehungsweise Laden die Richtungsanzeige prüfen und das Vorzeichen bei Bedarf umstellen.</p><p>Unter Energiezähler kannst du die Zähler für Erzeugung, Verbrauch und Netzbezug zuordnen. Ohne Zählerstatistik schätzt die Karte die kWh aus den erfassten Leistungswerten. Die Legende zeigt ihre Summen und blendet Reihen ein oder aus. Im Diagramm lassen sich Werte je Intervall mit Maus, Finger oder Pfeiltasten ansehen.</p><p>Mehrere Karten sind mit unterschiedlichen card_id-Werten unabhängig konfigurierbar. Einstellungen werden zentral gespeichert; Änderungen sind Administratoren vorbehalten.</p>'});}
  _onChange(e){
    if (e.target.id === 'period-from' || e.target.id === 'period-to') {
      this._customDraft = ['period-from', 'period-to'].map(id => this.shadowRoot.getElementById(id).value);
      return;
    }
    const key={title:'title','grid-positive':'grid_positive','battery-positive':'battery_positive'}[e.target.id];if(!this._admin||!key)return;this._draft||={...this.settings};this._draft[key]=e.target.value;
  }
  _navigateWithKey(e) {
    if (this.page !== 'history' || this.period === 'custom' || e.defaultPrevented ||
        !['ArrowLeft', 'ArrowRight'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey ||
        e.target.closest?.('input, select, textarea, [contenteditable], [data-chart]')) return;
    const action = e.key === 'ArrowLeft' ? 'previous-period' : 'next-period';
    e.preventDefault();
    return this._action({action, data: {}, element: e.target});
  }
  async _action({action,data,value,element}){
    if(action==='navigate'){this.page=data.page;this._message=null;this.render();if(this.page==='history')this._fetch();return;}
    if(action==='energy-node'){const entity=this.settings[{solar:'solar',grid:'grid',home:'home',battery:'battery'}[data.node]]||this.settings.soc;if(entity)this.dispatchEvent(new CustomEvent('hass-more-info',{detail:{entityId:entity},bubbles:true,composed:true}));return;}
    if (action === 'select-period' && Object.hasOwn(PERIODS, data.period)) {
      if (this.period === data.period) return;
      this.period = data.period;
      this._periodError = null;
      if (this.period === 'custom' && !this._custom) {
        this._sequence++;
        this._busy = false;
        this.render();
        return;
      }
      await this._fetch();
      return;
    }
    if (action === 'apply-period') {
      const dates = ['period-from', 'period-to'].map(id => this.shadowRoot.getElementById(id).value);
      if (!validCustomRange(...dates, this.today)) {
        this._periodError = 'Bitte einen gültigen Zeitraum von bis zu einem Jahr auswählen.';
        this.render();
        return;
      }
      this._custom = this._customDraft = dates;
      this._periodError = null;
      await this._fetch();
      return;
    }
    if (['previous-period', 'next-period', 'today'].includes(action) && this.period !== 'custom') {
      if (action !== 'previous-period' && !this._anchor) return;
      const today = this.today;
      const next = shiftAnchor(this.period, this._anchor || today, action === 'previous-period' ? -1 : 1);
      const current = historyRange(this.period, today, this.timezone, Date.now()).first;
      this._anchors[this.period] = action === 'today' || next >= current ? null : next;
      await this._fetch();
      return;
    }
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
window.customCards ||= [];
if (!window.customCards.some(card => card.type === 'pv-manager-card')) {
  window.customCards.push({type:'pv-manager-card',name:'PV Manager',description:'PV-Energiefluss und summierter Energieverlauf',preview:true});
}
