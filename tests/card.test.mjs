import {test} from 'node:test';
import assert from 'node:assert/strict';
// The initial asynchronous history render must work before any recorder response exists.
globalThis.HTMLElement=class{attachShadow(){this.shadowRoot={innerHTML:'',querySelector:()=>null};return this.shadowRoot;}};
globalThis.window={};const registry=new Map();globalThis.customElements={get:id=>registry.get(id),define:(id,value)=>registry.set(id,value)};
await import('../custom_components/pv_manager/frontend/pv-manager-card.js');
test('empty initial recorder responses and unknown sensors still render history',()=>{const Card=registry.get('pv-manager-card'),c=new Card();c.config={title:'PV',solar:'sensor.pv',grid:'sensor.grid',home:'sensor.home',soc:'sensor.soc'};c._settings={solar_energy:'sensor.energy'};c._hass={config:{time_zone:'Europe/Berlin'}};c.page='history';c._ready=true;const html=c._history();assert.equal((html.match(/class="fui-series-chart"/g)||[]).length,1);assert.match(html,/Keine Recorder-Daten für Erzeugung, Verbrauch, Netzbezug/);assert.match(html,/Energieverlauf/);assert.match(html,/Keine historischen Werte/);assert.ok(!html.includes('Invalid Date'));});

test('unconfigured history uses matching Sofar counters and estimates missing metrics from recorder power', async () => {
  const Card = registry.get('pv-manager-card');
  const card = new Card();
  card.setConfig({card_id: 'roof', grid_positive: 'export'});
  card.page = 'history';
  card._ready = true;
  card._anchors.day = '2026-11-16';
  const power = {attributes: {unit_of_measurement: 'W'}};
  const energy = {attributes: {unit_of_measurement: 'kWh', state_class: 'total_increasing'}};
  const calls = [];
  card._hass = {
    states: {
      'sensor.inverter_power': power,
      'sensor.inverter_load_power': power,
      'sensor.inverter_grid_power': power,
      'sensor.inverter_total_pv_generation': energy,
      'sensor.inverter_daily_pv_generation': energy,
      'sensor.other_total_energy_bought': energy,
    },
    callWS: async request => {
      calls.push(request);
      const start = Date.parse(request.start_time);
      const interval = {start, end: start + 300000};
      return request.types.includes('change')
        ? request.period === '5minute' ? {'sensor.inverter_daily_pv_generation': [{...interval, change: 0.12}]} : {}
        : {'sensor.inverter_load_power': [{...interval, mean: 3600}],
           'sensor.inverter_grid_power': [{...interval, mean: -1200}]};
    },
  };
  await card._fetch();
  assert.equal(calls[0].statistic_ids[0], 'sensor.inverter_today_production');
  assert.ok(calls[0].statistic_ids.includes('sensor.inverter_daily_pv_generation'));
  assert.ok(!calls[0].statistic_ids.includes('sensor.other_total_energy_bought'));
  assert.deepEqual(calls.at(-1).statistic_ids, ['sensor.inverter_load_power', 'sensor.inverter_grid_power']);
  assert.equal(card._data.solar_energy.points[0].y, 0.12);
  assert.equal(card._data.home_energy.points[0].y, 0.3);
  assert.equal(card._data.import_energy.points[0].y, 0.1);
  assert.match(card.shadowRoot.innerHTML, /Aus Leistungsstatistiken geschätzt: Verbrauch, Netzbezug/);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /Keine Recorder-Daten für/);
});

test('imported Sofar energy statistics take precedence without a live entity', async () => {
  const Card = registry.get('pv-manager-card');
  const card = new Card();
  card.setConfig({card_id: 'archived'});
  card.page = 'history';
  card.period = 'month';
  card._ready = true;
  card._anchors.month = '2026-07-01';
  const calls = [];
  const archived = 'sensor.inverter_today_production';
  const total = 'sensor.inverter_total_production';
  const home = 'sensor.inverter_today_load_consumption';
  const grid = 'sensor.inverter_today_energy_import';
  card._hass = {
    states: {},
    callWS: async request => {
      calls.push(request);
      const start = Date.parse(request.start_time);
      const row = change => [{start, change}];
      return {[archived]: row(86.42), [total]: row(90), [home]: row(22), [grid]: row(1)};
    },
  };
  await card._fetch();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].start_time, '2026-06-30T22:00:00.000Z');
  assert.equal(calls[0].end_time, '2026-07-31T21:59:59.999Z');
  assert.deepEqual([archived, total, home, grid].map(id => calls[0].statistic_ids.includes(id)), [true, true, true, true]);
  assert.equal(card._data.solar_energy.points[0].y, 86.42);
  assert.equal(card._data.home_energy.points[0].y, 22);
  assert.equal(card._data.import_energy.points[0].y, 1);
  assert.doesNotMatch(card.shadowRoot.innerHTML, /geschätzt/);
});

test('a historical day uses archived hourly counters when short-term data is gone', async () => {
  const Card = registry.get('pv-manager-card');
  const card = new Card();
  card.setConfig({card_id: 'historical', solar_energy: 'sensor.my_counter'});
  card.page = 'history';
  card._ready = true;
  card._anchors.day = '2026-07-01';
  card._hass = {
    states: {},
    callWS: async request => {
      assert.equal(request.statistic_ids[0], 'sensor.my_counter');
      assert.ok(!request.statistic_ids.includes('sensor.inverter_today_production'));
      return request.period === 'hour' ? {
        'sensor.my_counter': [{start: Date.parse(request.start_time), change: 1.25}],
      } : {};
    },
  };
  await card._fetch();
  assert.equal(card._data.solar_energy.points.length, 24);
  assert.equal(card._data.solar_energy.points[0].y, 1.25);
  assert.match(card.shadowRoot.innerHTML, /Stundenwerte aus der Langzeitstatistik/);
});
