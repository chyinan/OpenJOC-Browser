// pattern: Imperative Shell

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceRuntime, waitFor} from './helpers/extension-runtime.mjs';

async function createBackground(options = {}) {
  const listeners = [];
  const installedListeners = [];
  const startupListeners = [];
  const sent = [];
  const replies = [];
  let documentExists = true;
  const runtime = createSourceRuntime({caches: options.caches, console: options.console ?? console, chrome: {
    action: {onClicked: {addListener() {}}},
    runtime: {
      id: 'openjoc-test', getURL: path => `chrome-extension://openjoc-test/${path}`,
      getContexts: async () => options.getContexts ? options.getContexts(documentExists) : documentExists ? [{}] : [],
      onMessage: {addListener(listener) {listeners.push(listener);}},
      onInstalled: {addListener(listener) {installedListeners.push(listener);}},
      onStartup: {addListener(listener) {startupListeners.push(listener);}},
      async sendMessage(message) {sent.push(message);},
    },
    tabs: {async sendMessage(tabId, message) {replies.push(message);}},
    offscreen: {async createDocument() {documentExists = true;}, async closeDocument() {documentExists = false;}},
  }});
  await runtime.load('service-worker.js');
  return {
    sent,
    replies,
    loseOffscreen() {documentExists = false;},
    activate(documentId, tabId = 1) {
      for (const listener of listeners) listener({target: 'background', type: 'document-active'}, {id: 'openjoc-test', tab: {id: tabId}, documentId});
    },
    dispatch(message, documentId, tabId = 1) {
      for (const listener of listeners) listener(message, {id: 'openjoc-test', tab: {id: tabId}, documentId});
    },
    install(reason) {
      for (const listener of installedListeners) listener({reason});
    },
    startup() {
      for (const listener of startupListeners) listener();
    },
  };
}

function startMessage(generation, requestId, media = 'A') {
  return {
    target: 'background', type: 'start', generation, requestId,
    pageUrl: `https://www.bilibili.com/video/BV${media}/`,
    mediaKey: {bvid: `BV${media}`, aid: media, cid: media},
    candidates: [{id: 'dolby', source: 'dolby', codecs: 'ec-3', mimeType: 'audio/mp4', bandwidth: 1000000, baseUrl: 'https://media.bilivideo.com/audio.m4s', backupUrls: []}],
    videoTimeSamples: 0, dialnorm: 'unity', renderer: 'stereo',
  };
}

function hrtfSwitchMetrics(hrtf) {
  return {
    stage: 'hrtf-load-error-rollback', renderer: 'binaural', virtualLayout: '7.1.4', hrtf,
    binauralLatencyMs: null, binauralP95Ms: null, binauralMaxMs: null,
    currentVideoMediaTime: 0, currentAudioMediaTime: null, driftMs: null, averageDb: null,
    driftP50Ms: null, driftP95Ms: null, driftMaxMs: null, resyncCount: 0,
    compressedBufferMs: 0, pcmBufferMs: 0, underrunCount: 0,
    decodeMeanMs: 0, decodeP95Ms: 0, decodeMaxMs: 0, realtimeFactor: null,
    peakWasmMemoryBytes: 0, mediaUrl: null, audioContextTime: null, audioPerformanceTime: null,
    baseLatencyMs: null, outputLatencyMs: null, decodedAccessUnits: 0, outputFrames: 0,
    outputSamples: 0, workletProcessGapMaxMs: 0, workletProcessGapOver20MsCount: 0,
    workletPlayedQuantumCount: 0, workletSilentQuantumCount: 0, workletLastReadType: null,
  };
}

test('extension update and browser startup retry obsolete HRTF cache cleanup', async () => {
  const retiredAachenKey = 'https://openjoc-cache.invalid/openjoc-hrtf-v2.0.0/aachen-high-resolution-kemar/2cc2f2d93194be681d4e446d66b4007060bc6c768cf7026c92e5efb87cf06dc3';
  const retiredD2Key = 'https://openjoc-cache.invalid/openjoc-hrtf-v2.0.0/sadie-ii-d2-kemar/b2f42ca2ce9ef2dfa7e3eff263543c4f306d0ac95bd684cf5ca344c88d6bd461';
  const cacheEntries = new Set([retiredAachenKey, retiredD2Key]);
  let cacheKeyReads = 0;
  const cache = {
    async delete(request) { return cacheEntries.delete(String(request)); },
  };
  const caches = {
    async keys() {
      cacheKeyReads += 1;
      if (cacheKeyReads === 1) throw new Error('temporary Cache Storage failure');
      return ['openjoc-hrtf-assets-v2'];
    },
    async open() { return cache; },
  };
  const warnings = [];
  const testConsole = {...console, warn(...values) { warnings.push(values); }};
  const background = await createBackground({caches, console: testConsole});
  await new Promise(setImmediate);
  assert.equal(cacheKeyReads, 1, 'worker activation attempts the migration');

  background.install('update');
  await waitFor(() => cacheEntries.size === 0, 'HRTF cache cleanup after extension update');
  assert.equal(cacheKeyReads, 2, 'an update event retries a failed activation cleanup');
  assert.equal(warnings.length, 1, 'a failed migration reports a warning instead of silently disappearing');

  cacheEntries.add(retiredD2Key);
  background.startup();
  await waitFor(() => cacheEntries.size === 0, 'HRTF cache cleanup after browser startup');
  assert.equal(cacheKeyReads, 3, 'browser startup runs the migration again');
});

test('a different document can start a different media item with a lower page generation', async () => {
  const background = await createBackground();
  background.activate('old-document');
  background.dispatch(startMessage(40, 'old-request'), 'old-document');
  await waitFor(() => background.sent.some(m => m.requestId === 'old-request'), 'old session');
  const next = startMessage(1, 'new-request', 'B');
  background.activate('new-document');
  background.dispatch({...next, type: 'manifest'}, 'new-document');
  background.dispatch(next, 'new-document');
  await new Promise(setImmediate);
  assert.ok(background.sent.some(m => m.type === 'start' && m.requestId === 'new-request'), 'new document must not be rejected as an old generation');
});

test('an HRTF asset failure restores the previous binaural profile and playback request', async () => {
  const background = await createBackground();
  background.activate('document');
  const original = {...startMessage(1, 'hrtf-request'), renderer: 'binaural', hrtf: 'sadie-ii-d1-ku100'};
  background.dispatch(original, 'document');
  await waitFor(() => background.sent.some(message => message.type === 'start' && message.requestId === 'hrtf-request'), 'initial D1 session');

  const replacement = {...original, requestId: 'd2-request', generation: 2, hrtf: 'sadie-ii-d2-kemar'};
  background.dispatch(replacement, 'document');
  await waitFor(() => background.sent.some(message => message.type === 'start' && message.requestId === 'd2-request' && message.hrtf === replacement.hrtf), 'D2 replacement session');
  const failedStart = background.sent.findLast(message => message.type === 'start' && message.requestId === 'd2-request');
  assert.ok(failedStart);

  background.dispatch({
    target: 'background', type: 'offscreen-status', requestId: 'd2-request', tabId: 1,
    mediaKey: replacement.mediaKey, generation: failedStart.generation, phase: 'error',
    reason: 'HRTF selection failed (sadie-ii-d2-kemar): failed to load the packaged asset',
    inbandJocConfirmed: false, profile: null, metrics: hrtfSwitchMetrics('sadie-ii-d1-ku100'),
  }, 'document');

  await waitFor(() => background.sent.some(message => message.type === 'start'
    && message.requestId === 'd2-request'
    && message.generation === failedStart.generation + 1
    && message.hrtf === 'sadie-ii-d1-ku100'), 'previous D1 session restoration');
  assert.ok(background.replies.some(message => message.type === 'offscreen-status'
    && message.phase === 'preparing'
    && message.reason.startsWith('hrtf-load-error-rollback:')
    && message.metrics.hrtf === 'sadie-ii-d1-ku100'), 'the content UI is informed that D1 remains active');
});

test('a reclaimed audio document invalidates the old session and requests a fresh start', async () => {
  const background = await createBackground();
  const start = startMessage(5, 'paused-request');
  background.activate('document');
  background.dispatch(start, 'document');
  await waitFor(() => background.sent.some(m => m.type === 'start'), 'initial start');
  background.loseOffscreen();
  background.dispatch({target: 'background', type: 'video-clock', requestId: start.requestId,
    generation: 5, pageUrl: start.pageUrl, mediaKey: start.mediaKey, mediaTimeSamples: 480000,
    paused: false, buffering: false, playbackRate: 1, expectedDisplayTimeMs: null}, 'document');
  await new Promise(setImmediate);
  background.dispatch({target: 'background', type: 'session-heartbeat', requestId: start.requestId,
    generation: 5, pageUrl: start.pageUrl, mediaKey: start.mediaKey}, 'document');
  await new Promise(setImmediate);
  assert.ok(background.replies.some(m => m.type === 'request-session' && m.force && m.requestId === start.requestId));
  assert.equal(background.sent.filter(m => m.type === 'clock').length, 0, 'no clocks to an empty replacement document');
  background.dispatch({...startMessage(6, 'resumed-request'), videoTimeSamples: 480000}, 'document');
  await waitFor(() => background.sent.some(m => m.requestId === 'resumed-request'), 'recovery start');
});

test('another tab recreating the document cannot keep the old session marked live', async () => {
  const background = await createBackground();
  const old = startMessage(5, 'old-tab');
  background.activate('a');
  background.dispatch(old, 'a');
  await waitFor(() => background.sent.some(m => m.requestId === 'old-tab'), 'old tab');
  background.loseOffscreen();
  background.activate('b', 2);
  background.dispatch(startMessage(1, 'new-tab', 'B'), 'b', 2);
  await waitFor(() => background.sent.some(m => m.requestId === 'new-tab'), 'new tab');
  background.dispatch({...old, type: 'session-heartbeat'}, 'a');
  await new Promise(setImmediate);
  assert.ok(background.replies.some(m => m.type === 'request-session' && m.requestId === 'old-tab'));
  const count = background.replies.length;
  background.dispatch({...startMessage(1, 'new-tab', 'B'), type: 'session-heartbeat'}, 'b', 2);
  await new Promise(setImmediate);
  assert.equal(background.replies.length, count, 'the new start remains live');
});

test('a delayed empty liveness result cannot invalidate a newer request', async () => {
  let delayNext = false;
  let release;
  const background = await createBackground({getContexts(exists) {
    if (delayNext) {delayNext = false; return new Promise(resolve => {release = resolve;});}
    return exists ? [{}] : [];
  }});
  background.activate('a');
  background.dispatch(startMessage(1, 'old'), 'a');
  await waitFor(() => background.sent.some(m => m.requestId === 'old'), 'old start');
  delayNext = true;
  background.dispatch({...startMessage(1, 'old'), type: 'video-clock', mediaTimeSamples: 0,
    paused: false, buffering: false, playbackRate: 1, expectedDisplayTimeMs: null}, 'a');
  await waitFor(() => release !== undefined, 'pending liveness query');
  background.dispatch(startMessage(2, 'new'), 'a');
  await waitFor(() => background.sent.some(m => m.requestId === 'new'), 'new start');
  release([]);
  await new Promise(setImmediate);
  background.dispatch({...startMessage(2, 'new'), type: 'session-heartbeat'}, 'a');
  await new Promise(setImmediate);
  assert.equal(background.replies.filter(m => m.type === 'request-session').length, 0);
});

test('a delayed lower generation from the same document cannot reset its active session', async () => {
  const background = await createBackground();
  background.activate('same-document');
  background.dispatch(startMessage(40, 'current-request'), 'same-document');
  await waitFor(() => background.sent.some(m => m.requestId === 'current-request'), 'current session');
  background.dispatch(startMessage(1, 'stale-request'), 'same-document');
  await new Promise(setImmediate);
  assert.equal(background.sent.filter(m => m.type === 'start').length, 1);
});

test('refresh of the same item uses its new document generation even when the number is equal', async () => {
  const background = await createBackground();
  background.activate('before-document');
  background.dispatch(startMessage(1, 'before-refresh'), 'before-document');
  await waitFor(() => background.sent.some(m => m.requestId === 'before-refresh'), 'initial session');
  background.activate('after-document');
  background.dispatch(startMessage(1, 'after-refresh'), 'after-document');
  await new Promise(setImmediate);
  const start = background.sent.find(m => m.type === 'start' && m.requestId === 'after-refresh');
  assert.equal(start?.generation, 1);
});

test('late messages from a replaced document cannot take ownership back', async () => {
  const background = await createBackground();
  background.activate('old-document');
  background.dispatch(startMessage(8, 'old-request'), 'old-document');
  await waitFor(() => background.sent.some(m => m.requestId === 'old-request'), 'old session');
  background.activate('new-document');
  background.dispatch(startMessage(1, 'new-request', 'B'), 'new-document');
  await waitFor(() => background.sent.some(m => m.requestId === 'new-request'), 'new session');
  const messageCount = background.sent.length;
  background.dispatch({...startMessage(8, 'late-request'), type: 'manifest'}, 'old-document');
  background.dispatch(startMessage(8, 'late-request'), 'old-document');
  await new Promise(setImmediate);
  assert.equal(background.sent.length, messageCount, 'late old document messages cannot disable or replace the active session');
});

test('an explicit back-forward activation can restore a previously used document', async () => {
  const background = await createBackground();
  background.activate('document-a');
  background.dispatch(startMessage(8, 'first-a'), 'document-a');
  await waitFor(() => background.sent.some(m => m.requestId === 'first-a'), 'first document');
  background.activate('document-b');
  background.dispatch(startMessage(1, 'first-b', 'B'), 'document-b');
  await waitFor(() => background.sent.some(m => m.requestId === 'first-b'), 'second document');
  background.activate('document-a');
  background.dispatch(startMessage(8, 'restored-a'), 'document-a');
  await new Promise(setImmediate);
  assert.ok(background.sent.some(m => m.type === 'start' && m.requestId === 'restored-a'));
});

test('a clock from an obsolete request cannot advance or restart the replacement session', async () => {
  const background = await createBackground();
  background.activate('same-document');
  background.dispatch(startMessage(1, 'before-seek'), 'same-document');
  await waitFor(() => background.sent.some(m => m.requestId === 'before-seek'), 'initial request');
  background.dispatch(startMessage(2, 'after-seek'), 'same-document');
  await waitFor(() => background.sent.some(m => m.requestId === 'after-seek'), 'replacement request');
  const baseline = background.sent.length;
  const clock = {
    target: 'background', type: 'video-clock', requestId: 'before-seek', generation: 99,
    pageUrl: 'https://www.bilibili.com/video/BVA/', mediaKey: {bvid: 'BVA', aid: 'A', cid: 'A'},
    mediaTimeSamples: 48000, paused: false, buffering: false, playbackRate: 1, expectedDisplayTimeMs: null,
  };
  background.dispatch(clock, 'same-document');
  await new Promise(setImmediate);
  assert.equal(background.sent.length, baseline);
  background.dispatch({...clock, requestId: 'after-seek', generation: 2}, 'same-document');
  await new Promise(setImmediate);
  assert.equal(background.sent.at(-1)?.type, 'clock');
});

test('a delayed running clock cannot arrive after a newer paused clock', async () => {
  let contextCall = 0;
  const releases = [];
  const background = await createBackground({getContexts(exists) {
    if (contextCall++ === 0) return exists ? [{}] : [];
    return new Promise(resolve => {releases.push(resolve);});
  }});
  const start = startMessage(1, 'ordered-clock');
  background.activate('document');
  background.dispatch(start, 'document');
  await waitFor(() => background.sent.some(m => m.requestId === start.requestId), 'initial session');

  const clock = {buffering: false, playbackRate: 1, expectedDisplayTimeMs: null};
  background.dispatch({...start, ...clock, type: 'video-clock', paused: false, mediaTimeSamples: 48000}, 'document');
  background.dispatch({...start, ...clock, type: 'video-clock', paused: true, mediaTimeSamples: 48000}, 'document');
  await waitFor(() => releases.length >= 1, 'clock liveness checks');
  if (releases.length >= 2) {
    releases[1]([{}]);
    await new Promise(setImmediate);
    releases[0]([{}]);
  } else {
    releases[0]([{}]);
    await waitFor(() => releases.length >= 2, 'serialized paused clock liveness check');
    releases[1]([{}]);
  }
  await waitFor(() => background.sent.filter(m => m.type === 'clock').length === 2, 'both clocks to reach offscreen');
  assert.equal(background.sent.filter(m => m.type === 'clock').at(-1)?.paused, true);
});
