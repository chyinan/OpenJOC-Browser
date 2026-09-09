// pattern: Imperative Shell

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceRuntime} from './helpers/extension-runtime.mjs';

class FakeElement {
  constructor() {
    this.dataset = {};
    this.hidden = false;
    this.innerHTML = '';
    this.textContent = '';
    this.classList = {toggle() {}, add() {}, remove() {}};
    this.style = {setProperty() {}};
  }

  addEventListener() {}
  append() {}
  attachShadow() {return new FakeElement();}
  querySelector() {return null;}
  querySelectorAll() {return [];}
  setAttribute() {}
}

test('the hidden overlay keeps its latest state available on the page host', async () => {
  const hosts = [];
  const document = {
    createElement() {return new FakeElement();},
    documentElement: {append(element) {hosts.push(element);}},
  };
  const runtime = createSourceRuntime({document});
  const {createJocOverlayController} = await runtime.load('joc-overlay-controller.js');
  const controller = createJocOverlayController({
    onEnable() {}, onDisable() {}, onRendererChange() {}, onDialnormChange() {},
    onAlwaysEnabledChange() {}, onGainChange() {}, onReturnNative() {},
  });
  const host = hosts[0];
  assert.ok(host, 'the overlay host is attached to the page');
  controller.setManifest(true);
  assert.equal(JSON.parse(host.dataset.openjocState).mode, 'detected');
  assert.equal(JSON.parse(host.dataset.openjocState).hasJoc, true);
  controller.reset();
  assert.equal(JSON.parse(host.dataset.openjocState).mode, 'hidden');
  assert.equal(JSON.parse(host.dataset.openjocState).hasJoc, false);
});
