import assert from 'node:assert/strict';
import {test} from 'node:test';

test('the YAML loader waits for the active Home Assistant registry', {timeout: 2000}, async () => {
  const oldElements = new Map();
  globalThis.window = {};
  globalThis.HTMLElement = class {};
  globalThis.customElements = {
    get: name => oldElements.get(name),
    define: (name, element) => oldElements.set(name, element),
  };

  let retry;
  const setTimeout = globalThis.setTimeout;
  try {
    globalThis.setTimeout = callback => { retry = callback; };
    await import('../custom_components/pv_manager/frontend/pv-manager-loader.js?v=test');
  } finally {
    globalThis.setTimeout = setTimeout;
  }
  assert.equal(oldElements.size, 0);
  assert.equal(typeof retry, 'function');

  const activeElements = new Map([['home-assistant', class {}]]);
  const {promise, resolve} = Promise.withResolvers();
  globalThis.customElements = {
    get: name => activeElements.get(name),
    define(name, element) {
      activeElements.set(name, element);
      if (name === 'pv-manager-card-editor') resolve();
    },
  };
  retry();
  await promise;
  assert.ok(activeElements.has('pv-manager-card'));
  await import('../custom_components/pv_manager/frontend/pv-manager-card.js?second-url');
  assert.equal(window.customCards.filter(card => card.type === 'pv-manager-card').length, 1);
});
