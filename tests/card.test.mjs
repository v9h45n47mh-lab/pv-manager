import {test} from 'node:test';
import assert from 'node:assert/strict';
// The initial asynchronous history render must work before any recorder response exists.
globalThis.HTMLElement=class{attachShadow(){this.shadowRoot={innerHTML:'',querySelector:()=>null};return this.shadowRoot;}};
globalThis.window={};const registry=new Map();globalThis.customElements={get:id=>registry.get(id),define:(id,value)=>registry.set(id,value)};
await import('../custom_components/pv_manager/frontend/pv-manager-card.js');
test('empty initial recorder responses and unknown sensors still render history',()=>{const Card=registry.get('pv-manager-card'),c=new Card();c.config={title:'PV',solar:'sensor.pv',grid:'sensor.grid',home:'sensor.home',soc:'sensor.soc'};c._settings={solar_energy:'sensor.energy'};c._hass={config:{time_zone:'Europe/Berlin'}};c.page='history';const html=c._history();assert.equal((html.match(/class="fui-series-chart"/g)||[]).length,1);assert.match(html,/Fehlende Energiezähler in den Einstellungen zuordnen: Verbrauch, Netzbezug/);assert.match(html,/Energieverlauf/);assert.match(html,/Keine historischen Werte/);assert.ok(!html.includes('Invalid Date'));});
