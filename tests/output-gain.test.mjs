// pattern: Imperative Shell

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaybackRuntime, createSourceRuntime} from './helpers/extension-runtime.mjs';

test('gain policy defaults to zero and constrains saved or typed values to half-dB steps', async () => {
  const gain = await createSourceRuntime().load('output-gain.js');
  for (const value of [null, undefined, '', '6', NaN, Infinity]) assert.equal(gain.normalizeOutputGainDb(value), 0);
  assert.equal(gain.normalizeOutputGainDb(-30), -20);
  assert.equal(gain.normalizeOutputGainDb(30), 20);
  assert.equal(gain.normalizeOutputGainDb(6.26), 6.5);
  assert.equal(gain.gainDbToAmplitude(0), 1);
  assert.ok(Math.abs(gain.gainDbToAmplitude(20) - 10) < 1e-9);
  assert.ok(Math.abs(gain.gainDbToAmplitude(-20) - 0.1) < 1e-9);
});

test('gain messages are bounded and tied to the current playback request', async () => {
  const {isRuntimeMessage} = await createSourceRuntime().load('extension-protocol.js');
  const message = {target: 'background', type: 'output-gain', requestId: 'current', generation: 1, gainDb: 6};
  assert.ok(isRuntimeMessage(message));
  assert.ok(isRuntimeMessage({...message, gainDb: -20}));
  assert.ok(isRuntimeMessage({...message, gainDb: 20}));
  assert.ok(isRuntimeMessage({...message, target: 'offscreen', tabId: 1}));
  assert.equal(isRuntimeMessage({...message, gainDb: 21}), false);
  assert.equal(isRuntimeMessage({...message, gainDb: -21}), false);
  assert.equal(isRuntimeMessage({...message, gainDb: NaN}), false);
  assert.equal(isRuntimeMessage({...message, requestId: ''}), false);
});

async function processorWithConstantPcm(frames = 128) {
  let Processor;
  const stats = [];
  const runtime = createSourceRuntime({
    sampleRate: 48000,
    AudioWorkletProcessor: class {constructor() {this.port = {onmessage: null, postMessage: message => stats.push(message)};}},
    registerProcessor(_name, constructor) {Processor = constructor;},
  });
  await runtime.load('pcm-processor.js');
  const processor = new Processor();
  const samples = new Float32Array(frames * 2).fill(0.25);
  processor.port.onmessage({data: {type: 'reset', generation: 1}});
  processor.port.onmessage({data: {type: 'pcm', generation: 1, sequence: 1, buffer: samples.buffer, ptsSamples: null}});
  return {processor, stats, Processor};
}

test('worklet applies the gain parameter to both channels without changing sample count', async () => {
  const {processor, Processor} = await processorWithConstantPcm();
  assert.equal(Processor.parameterDescriptors?.find(parameter => parameter.name === 'outputGain')?.defaultValue, 1);
  const output = [new Float32Array(128), new Float32Array(128)];
  processor.process([], [output], {outputGain: new Float32Array([2])});
  assert.ok(output.every(channel => channel.every(sample => sample === 0.5)));
});

test('worklet follows per-sample gain automation so browser smoothing is preserved', async () => {
  const {processor} = await processorWithConstantPcm();
  const output = [new Float32Array(128), new Float32Array(128)];
  const automation = Float32Array.from({length: 128}, (_, index) => 1 + index / 128);
  processor.process([], [output], {outputGain: automation});
  for (let index = 0; index < 128; index += 1) {
    assert.equal(output[0][index], Math.fround(0.25 * automation[index]));
    assert.equal(output[1][index], output[0][index]);
  }
});

test('zero-dB default preserves PCM and the loudness meter measures post-gain output', async () => {
  const first = await processorWithConstantPcm();
  const unchanged = [new Float32Array(128), new Float32Array(128)];
  first.processor.process([], [unchanged], {outputGain: new Float32Array([1])});
  assert.ok(unchanged.every(channel => channel.every(sample => sample === 0.25)));
  const {processor, stats} = await processorWithConstantPcm(48000);
  for (let index = 0; index < 384; index += 1) {
    processor.process([], [[new Float32Array(128), new Float32Array(128)]], {outputGain: new Float32Array([2])});
  }
  assert.ok(Math.abs(stats.at(-1).averageDb - 20 * Math.log10(0.5)) < 1e-5);
});

test('gain changed during a queued startup is applied to that request and stale tab controls are ignored', async () => {
  const playback = await createPlaybackRuntime();
  try {
    playback.start(1, 'first'); await playback.active('first');
    playback.start(2, 'second');
    playback.dispatch({target: 'offscreen', type: 'output-gain', tabId: 1, generation: 2, requestId: 'second', gainDb: -6});
    await playback.active('second');
    assert.ok(Math.abs(playback.outputGain - 10 ** (-6 / 20)) < 1e-9);
    playback.dispatch({target: 'offscreen', type: 'output-gain', tabId: 2, generation: 2, requestId: 'second', gainDb: 6});
    playback.dispatch({target: 'offscreen', type: 'output-gain', tabId: 1, generation: 1, requestId: 'first', gainDb: 6});
    assert.ok(Math.abs(playback.outputGain - 10 ** (-6 / 20)) < 1e-9);
  } finally {playback.close();}
});

test('explicit reset saves zero even when the gain control still shows its initial zero', async () => {
  const elements = [];
  class Element {
    dataset = {};
    events = new Map();
    classList = {toggle() {}};
    append() {}
    setAttribute() {}
    attachShadow() {return new Element();}
    addEventListener(name, callback) {this.events.set(name, callback);}
    querySelectorAll() {return [];}
    querySelector() {return null;}
    closest() {return this;}
  }
  const document = {
    documentElement: new Element(),
    createElement() {const element = new Element(); elements.push(element); return element;},
  };
  const saved = [];
  const runtime = createSourceRuntime({document, Element});
  const {createJocOverlayController} = await runtime.load('joc-overlay-controller.js');
  const controller = createJocOverlayController({onGainChange: gainDb => saved.push(gainDb)});
  controller.setManifest(true); controller.setRequested(true);
  const panel = elements.find(element => element.className === 'panel');
  const action = new Element(); action.dataset.action = 'open-diagnostics';
  panel.events.get('click')({target: action});
  assert.match(panel.innerHTML, /data-action="reset-gain"/);
  assert.match(panel.innerHTML, /min="-20" max="20"/);
  assert.match(panel.innerHTML, /−20 dB.*\+20 dB/);
  action.dataset.action = 'reset-gain';
  panel.events.get('click')({target: action});
  assert.deepEqual(saved, [0], 'reset must notify persistence even before a delayed saved setting is restored');
});
