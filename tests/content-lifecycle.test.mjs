// pattern: Imperative Shell

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaybackRuntime, createSourceRuntime} from './helpers/extension-runtime.mjs';

test('long pause resumes a confirmed stream even when its last stage was fetching a segment', async () => {
  const playback = await createPlaybackRuntime();
  let status;
  try {
    playback.start(1, 'fixture');
    status = await playback.active('fixture');
  } finally {
    playback.close();
  }

  let now = 0;
  let requested = false;
  const timers = [];
  const runtimeListeners = [];
  const pageListeners = [];
  const videoListeners = new Map();
  const sent = [];
  const video = {
    paused: false, seeking: false, muted: false, defaultMuted: false, volume: 1,
    currentTime: 0, readyState: 4, playbackRate: 1, clientWidth: 1280, clientHeight: 720,
    addEventListener(name, listener) {videoListeners.set(name, listener);},
  };
  const pageWindow = {
    addEventListener(_name, listener) {pageListeners.push(listener);},
    postMessage() {},
    setInterval(callback) {timers.push(callback); return timers.length;},
  };
  const runtime = createSourceRuntime({
    window: pageWindow, location: {href: 'https://www.bilibili.com/video/BVA/'},
    performance: {now: () => now}, console: {info() {}},
    document: {visibilityState: 'visible', querySelectorAll: () => [video], addEventListener() {}},
    chrome: {
      runtime: {id: 'test', onMessage: {addListener(listener) {runtimeListeners.push(listener);}}, async sendMessage(message) {sent.push(message);}},
      storage: {local: {async get() {return {alwaysEnableOpenJoc: true};}, async set() {}}},
    },
  }, {
    'joc-overlay-controller.js': {createJocOverlayController: () => ({
      reset() {}, setManifest() {}, setStatus() {}, setAlwaysEnabled() {}, setDialnorm() {}, setRenderer() {}, setGainDb() {}, setDebugSummary() {},
      setRequested(value) {requested = value;},
    })},
  });
  await runtime.load('bilibili-content.js');
  await new Promise(setImmediate);
  const manifest = {
    source: 'openjoc-bilibili', type: 'manifest', pageOrigin: 'https://www.bilibili.com', pageUrl: 'https://www.bilibili.com/video/BVA/',
    mediaKey: status.mediaKey,
    candidates: [{id: 'dolby', source: 'dolby', codecs: 'ec-3', mimeType: 'audio/mp4', bandwidth: 1000000, baseUrl: 'https://media.bilivideo.com/audio.m4s', backupUrls: []}],
  };
  for (const listener of pageListeners) listener({source: pageWindow, origin: manifest.pageOrigin, data: manifest});
  const start = sent.find(message => message.type === 'start');
  assert.ok(start, 'saved preference starts OpenJOC');
  assert.equal(sent[0]?.type, 'document-active', 'the document activates before any session messages are sent');
  const update = {...status, requestId: start.requestId, generation: start.generation, phase: 'paused', metrics: {...status.metrics, stage: 'fetching-segment'}};
  for (const listener of runtimeListeners) listener(update, {id: 'test'});
  video.paused = true;
  now = 120_000;
  for (const timer of timers) timer();
  video.paused = false;
  videoListeners.get('play')();
  for (const timer of timers) timer();
  assert.ok(requested, 'a resumed confirmed stream remains enabled while its next status is in flight');
  assert.equal(sent.filter(message => message.type === 'disable').length, 0);
});
