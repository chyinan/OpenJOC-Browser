// pattern: Imperative Shell

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaybackRuntime, createSourceRuntime, waitFor} from './helpers/extension-runtime.mjs';
import {createNativeAudioRuntime} from './helpers/native-audio-runtime.mjs';

/** Real content -> background -> offscreen -> worker -> AudioWorklet, with a local media fixture. */
async function createExtension(options = {}) {
  const backgroundListeners = [];
  const pages = new Map();
  const messages = [];
  let playback;
  let documentExists = true;
  let shouldDropNextStart = false;
  let shouldFailNextOffscreenStart = false;
  let shouldFailAllOffscreenStarts = false;
  let shouldHoldStatuses = false;
  const heldStatuses = [];
  let preferences = {alwaysEnableOpenJoc: false, ...options.preferences};
  const background = createSourceRuntime({chrome: {
    action: {onClicked: {addListener() {}}},
    runtime: {
      id: 'openjoc-test', getURL: path => `chrome-extension://openjoc-test/${path}`,
      getContexts: async () => documentExists ? [{}] : [],
      onMessage: {addListener(listener) {backgroundListeners.push(listener);}},
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'start' && (shouldFailNextOffscreenStart || shouldFailAllOffscreenStarts)) {
          shouldFailNextOffscreenStart = false;
          throw new Error('offscreen receiver unavailable');
        }
        playback.dispatch(message);
      },
    },
    tabs: {async sendMessage(tabId, message) {messages.push(message); pages.get(tabId)?.receive(message);}},
    offscreen: {async createDocument() {playback = await newPlayback(); documentExists = true;}, async closeDocument() {playback.close(); documentExists = false;}},
  }});
  await background.load('service-worker.js');
  async function newPlayback() {return createPlaybackRuntime({segments: options.segments, onFetchIndex: options.onFetchIndex, autoReady: false, onStatus: message => {
    messages.push(message);
    if (shouldHoldStatuses) {heldStatuses.push(message); return;}
    for (const listener of backgroundListeners) listener(message, {id: 'openjoc-test'});
  }});}
  playback = await newPlayback();

  return {
    messages,
    loseOffscreen() {playback.close(); documentExists = false;},
    get outputGain() {return playback.outputGain;},
    get gainAutomation() {return playback.gainAutomation;},
    dropNextStart() {shouldDropNextStart = true;},
    failNextOffscreenStart() {shouldFailNextOffscreenStart = true;},
    failAllOffscreenStarts() {shouldFailAllOffscreenStarts = true;},
    holdStatuses() {shouldHoldStatuses = true;},
    releaseStatuses() {
      shouldHoldStatuses = false;
      for (const message of heldStatuses.splice(0)) {
        for (const listener of backgroundListeners) listener(message, {id: 'openjoc-test'});
      }
    },
    async page(documentId, pageOptions = {}) {
      const nativeAudio = await createNativeAudioRuntime();
      const listeners = [];
      const windowEvents = new Map();
      const timers = [];
      let callbacks;
      let status = null;
      let requested = false;
      let debug = '';
      let clockOffsetMs = 0;
      let currentRequestId = null;
      let hasCandidate = false;
      let uiDialnorm = 'calibrated';
      let uiRenderer = 'stereo-speakers';
      let uiGainDb = 0;
      const video = Object.assign(nativeAudio.video, {
        paused: pageOptions.paused ?? false, seeking: false, muted: pageOptions.muted ?? false, defaultMuted: false, volume: 1,
        currentTime: 0, readyState: 4, playbackRate: 1, clientWidth: 1280, clientHeight: 720,
      });
      const pageWindow = {
        addEventListener(name, listener) {windowEvents.set(name, listener);},
        postMessage(message) {queueMicrotask(() => nativeAudio.dispatch(message));}, setInterval(callback) {timers.push(callback); return timers.length;},
      };
      nativeAudio.onState(message => queueMicrotask(() => windowEvents.get('message')?.({source: pageWindow, origin: 'https://www.bilibili.com', data: message})));
      const page = {
        video,
        physicalMuted() {return nativeAudio.physicalMuted();},
        get status() {return status;},
        get requested() {return requested;},
        get debug() {return debug;},
        get hasCandidate() {return hasCandidate;},
        get uiDialnorm() {return uiDialnorm;},
        get uiRenderer() {return uiRenderer;},
        get uiGainDb() {return uiGainDb;},
        receive(message) {for (const listener of listeners) listener(message, {id: 'openjoc-test'});},
        enable() {callbacks.onEnable({dialnorm: uiDialnorm, renderer: uiRenderer});},
        disable() {callbacks.onDisable();},
        alwaysEnable() {callbacks.onAlwaysEnabledChange(true);},
        dialnorm(mode) {uiDialnorm = mode; callbacks.onDialnormChange(mode);},
        renderer(mode) {uiRenderer = mode; callbacks.onRendererChange(mode);},
        gain(gainDb) {uiGainDb = gainDb; callbacks.onGainChange(gainDb);},
        event(name) {video.dispatchEvent(new Event(name));},
        tick() {for (const timer of timers) timer();},
        advanceClock(ms) {clockOffsetMs += ms; this.tick();},
        manifest() {
          windowEvents.get('message')({source: pageWindow, origin: 'https://www.bilibili.com', data: {
            source: 'openjoc-bilibili', type: 'manifest', pageOrigin: 'https://www.bilibili.com', pageUrl: 'https://www.bilibili.com/video/BVA/',
            mediaKey: {bvid: 'BVA', aid: 'A', cid: 'A'},
            candidates: [{id: 'dolby', source: 'dolby', codecs: 'ec-3', mimeType: 'audio/mp4', bandwidth: 1000000, baseUrl: 'https://media.bilivideo.com/audio.m4s', backupUrls: []}],
          }});
        },
        unavailable() {
          windowEvents.get('message')({source: pageWindow, origin: 'https://www.bilibili.com', data: {
            source: 'openjoc-bilibili', type: 'unavailable', pageOrigin: 'https://www.bilibili.com', pageUrl: 'https://www.bilibili.com/video/BVA/', reason: 'no JOC audio in this item',
          }});
        },
        async active() {
          await waitFor(() => {
            if (status?.phase === 'error') throw new Error(`${status.reason}; ${debug}`);
            return status?.phase === 'active' && status.requestId === currentRequestId && status.metrics.currentAudioMediaTime !== null;
          }, `${documentId} to play PCM through the full message chain`);
        },
      };
      pages.set(1, page);
      const content = createSourceRuntime({
        window: pageWindow, location: {href: 'https://www.bilibili.com/video/BVA/'}, console: {info() {}},
        performance: {now: () => performance.now() + clockOffsetMs},
        document: {visibilityState: 'visible', querySelectorAll: () => [video], addEventListener() {}},
        chrome: {
          runtime: {
            id: 'openjoc-test', onMessage: {addListener(listener) {listeners.push(listener);}},
            async sendMessage(message) {
              messages.push(message);
              if (message.type === 'start') currentRequestId = message.requestId;
              if (message.type === 'start' && shouldDropNextStart) {shouldDropNextStart = false; return;}
              for (const listener of backgroundListeners) listener(message, {id: 'openjoc-test', tab: {id: 1}, documentId});
            },
          },
          storage: {local: {
            async get() {const snapshot = {...preferences}; await options.beforeReadPreferences?.(); return snapshot;},
            async set(value) {preferences = {...preferences, ...value};},
          }},
        },
      }, {'joc-overlay-controller.js': {createJocOverlayController(options) {
        callbacks = options;
        return {
          reset() {}, setManifest(value) {hasCandidate = value;}, setAlwaysEnabled() {},
          setDialnorm(value) {uiDialnorm = value;},
          setRenderer(value) {uiRenderer = value;},
          setGainDb(value) {uiGainDb = value;},
          setStatus(value) {status = value;}, setRequested(value) {requested = value;}, setDebugSummary(value) {debug = value;},
        };
      }}});
      await content.load('bilibili-content.js');
      await new Promise(setImmediate);
      return page;
    },
    close() {playback.close();},
  };
}

test('manual first play followed by saved automatic enable on repeated refreshes', async () => {
  const extension = await createExtension();
  try {
    const first = await extension.page('first-document');
    first.manifest();
    first.enable();
    await first.active();
    first.alwaysEnable();
    for (let refresh = 0; refresh < 5; refresh += 1) {
      const next = await extension.page(`refresh-${refresh}`);
      next.manifest();
      next.tick();
      await next.active();
      assert.ok(next.requested);
    }
  } finally {
    extension.close();
  }
});

test('Bilibili mute and volume operate through the full bridge without restarting playback', async () => {
  const extension = await createExtension();
  try {
    const page = await extension.page('volume-controls');
    page.video.volume = 0.6;
    page.manifest(); page.enable(); await page.active();
    assert.equal(page.video.muted, false);
    assert.equal(extension.outputGain, 0.6);
    const starts = extension.messages.filter(m => m.target === 'offscreen' && m.type === 'start').length;
    page.video.muted = true;
    await waitFor(() => extension.outputGain === 0, 'mute output');
    page.gain(6);
    page.video.volume = 0.25;
    await new Promise(setImmediate);
    assert.equal(extension.outputGain, 0, 'volume and custom gain cannot unmute');
    page.video.muted = false;
    await waitFor(() => Math.abs(extension.outputGain - 0.25 * 10 ** (6 / 20)) < 1e-9, 'unmute output');
    assert.equal(extension.messages.filter(m => m.target === 'offscreen' && m.type === 'start').length, starts);
    page.disable();
    await new Promise(setImmediate);
    assert.equal(page.video.muted, false);
    assert.equal(page.video.volume, 0.25);
    assert.equal(Object.hasOwn(page.video, 'muted'), false);
  } finally {extension.close();}
});

test('starting OpenJOC from an already paused video preserves the paused state', async () => {
  const extension = await createExtension();
  try {
    const page = await extension.page('paused-start');
    page.video.paused = true;
    page.manifest();
    page.enable();
    await waitFor(() => extension.messages.some(message => message.target === 'offscreen' && message.type === 'start'), 'paused start request');
    const start = extension.messages.find(message => message.target === 'offscreen' && message.type === 'start');
    assert.equal(start?.paused, true);
    assert.equal(start?.buffering, false);
  } finally {extension.close();}
});

test('paused startup waits for the first unmuted play before taking native audio control', async () => {
  const extension = await createExtension();
  try {
    const page = await extension.page('paused-native-handoff', {paused: true});
    page.manifest();
    page.enable();
    await waitFor(() => extension.messages.some(message => message.type === 'offscreen-status' && message.phase === 'ready'), 'paused startup readiness');
    assert.equal(page.physicalMuted(), false, 'paused startup must not physically mute the original video');

    page.video.paused = false;
    page.event('play');
    await page.active();
    assert.equal(page.physicalMuted(), true, 'native audio is suppressed after the first unmuted play');

    page.disable();
    await new Promise(setImmediate);
    assert.equal(page.physicalMuted(), false, 'disabling OpenJOC restores native audio');
  } finally {extension.close();}
});

test('muted autoplay waits for user unmute before taking native audio control', async () => {
  const extension = await createExtension();
  try {
    const page = await extension.page('muted-autoplay', {muted: true});
    page.manifest();
    page.enable();
    await waitFor(() => extension.messages.some(message => message.type === 'offscreen-status' && message.phase === 'ready'), 'muted autoplay readiness');
    assert.equal(Object.hasOwn(page.video, 'muted'), false, 'user-muted autoplay must not install the extension accessor');

    page.video.muted = false;
    await page.active();
    assert.equal(Object.hasOwn(page.video, 'muted'), true, 'unmuting a playing video permits native audio takeover');
    page.disable();
  } finally {extension.close();}
});

test('resume rebuilds a reclaimed audio document without another enable click', async () => {
  const extension = await createExtension({preferences: {alwaysEnableOpenJoc: true, dialnormMode: 'unity', outputGainDb: -3}});
  try {
    const page = await extension.page('long-pause');
    page.manifest();
    await page.active();
    const initialRequest = page.status.requestId;
    page.video.volume = 0.35;
    page.video.muted = true;
    page.video.paused = true;
    page.event('pause');
    await new Promise(setImmediate);
    extension.loseOffscreen();
    page.video.currentTime = 1;
    page.video.paused = false;
    page.event('playing');
    page.advanceClock(31000);
    await waitFor(() => extension.messages.some(m => m.type === 'start' && m.requestId !== initialRequest), 'new request after offscreen loss');
    await page.active();
    assert.notEqual(page.status.requestId, initialRequest);
    assert.equal(page.requested, true);
    const restart = extension.messages.filter(m => m.target === 'offscreen' && m.type === 'start').at(-1);
    assert.equal(restart.videoTimeSamples, 48000);
    assert.equal(restart.dialnorm, 'unity');
    assert.equal(restart.gainDb, -3);
    assert.equal(extension.outputGain, 0, 'recovery retains player mute');
    page.video.muted = false;
    await waitFor(() => Math.abs(extension.outputGain - 0.35 * 10 ** (-3 / 20)) < 1e-9, 'restored player volume after recovery');
  } finally {extension.close();}
});

test('automatic startup survives a player seek while the previous document is being stopped', async () => {
  const extension = await createExtension();
  try {
    const first = await extension.page('first-document');
    first.manifest();
    first.enable();
    await first.active();
    first.alwaysEnable();
    const next = await extension.page('refresh-document');
    next.manifest();
    next.video.seeking = true;
    next.event('seeking');
    next.tick();
    next.video.currentTime = 1;
    next.video.seeking = false;
    next.event('seeked');
    next.tick();
    await next.active();
    assert.ok(next.requested);
  } finally {
    extension.close();
  }
});

test('a missing automatic start recovers on the background heartbeat without a manual click', async () => {
  const extension = await createExtension();
  try {
    const first = await extension.page('first-document');
    first.manifest(); first.enable();
    await first.active(); first.alwaysEnable();
    const next = await extension.page('refresh-document');
    extension.dropNextStart();
    next.manifest();
    await new Promise(setImmediate);
    for (let heartbeat = 0; heartbeat < 3; heartbeat += 1) {
      next.advanceClock(1_100);
      await new Promise(setImmediate);
    }
    assert.ok(extension.messages.filter(message => message.target === 'background' && message.type === 'start').length > 2,
      `background recovery must break the pending-start deadlock: ${next.debug}`);
    await next.active();
    assert.ok(next.requested);
  } finally {extension.close();}
});

test('a received slow start is not replaced merely because its generation acknowledgement is delayed', async () => {
  const extension = await createExtension();
  try {
    const page = await extension.page('same-document');
    page.manifest(); page.enable(); await page.active();
    extension.holdStatuses();
    const baseline = extension.messages.length;
    page.enable();
    await new Promise(setImmediate);
    for (let heartbeat = 0; heartbeat < 3; heartbeat += 1) {
      page.advanceClock(1_100);
      await new Promise(setImmediate);
    }
    assert.equal(extension.messages.slice(baseline).filter(message => message.type === 'request-session').length, 0,
      'an accepted request identity is authoritative while its first decoder status is pending');
    extension.releaseStatuses();
    await page.active();
  } finally {extension.close();}
});

test('a delayed recovery request for an old start cannot restart the replacement session', async () => {
  const extension = await createExtension();
  try {
    const page = await extension.page('same-document');
    page.manifest(); page.enable(); await page.active();
    const oldRequest = extension.messages.find(message => message.target === 'background' && message.type === 'start');
    page.enable(); await page.active();
    const baseline = extension.messages.filter(message => message.target === 'background' && message.type === 'start').length;
    page.receive({target: 'background', type: 'request-session', force: true, requestId: oldRequest.requestId, generation: oldRequest.generation});
    await new Promise(setImmediate);
    assert.equal(extension.messages.filter(message => message.target === 'background' && message.type === 'start').length, baseline);
  } finally {extension.close();}
});

test('a failed offscreen delivery is recovered instead of remaining marked as started', async () => {
  const extension = await createExtension();
  try {
    const page = await extension.page('first-document');
    page.manifest(); extension.failNextOffscreenStart(); page.enable();
    await new Promise(setImmediate);
    page.advanceClock(1_100);
    await new Promise(setImmediate);
    assert.ok(extension.messages.filter(message => message.target === 'offscreen' && message.type === 'start').length > 1);
    await page.active();
  } finally {extension.close();}
});

test('repeated unavailable offscreen deliveries still respect the original startup deadline', async () => {
  const extension = await createExtension();
  try {
    const page = await extension.page('first-document');
    page.manifest(); extension.failAllOffscreenStarts(); page.enable();
    await new Promise(setImmediate);
    for (let heartbeat = 0; heartbeat < 36; heartbeat += 1) {
      page.advanceClock(1_100);
      await new Promise(setImmediate);
    }
    assert.equal(page.requested, false, 'unrecoverable startup must not stay enabled forever');
  } finally {extension.close();}
});

test('a failed background dialnorm restart is recovered by the same request-aware heartbeat', async () => {
  const extension = await createExtension();
  try {
    const page = await extension.page('same-document');
    page.manifest(); page.enable(); await page.active();
    const baseline = extension.messages.length;
    extension.failNextOffscreenStart();
    page.dialnorm('calibrated');
    await new Promise(setImmediate);
    page.advanceClock(1_100);
    await new Promise(setImmediate);
    assert.ok(extension.messages.slice(baseline).some(message => message.type === 'request-session'), 'failed background restarts must not remain falsely marked as started');
    await page.active();
  } finally {extension.close();}
});

test('ordinary audio stays native and has no OpenJOC candidate even with always-enable saved', async () => {
  const extension = await createExtension();
  try {
    const page = await extension.page('ordinary-document');
    page.alwaysEnable(); page.unavailable(); page.tick();
    await new Promise(setImmediate);
    assert.equal(page.hasCandidate, false);
    assert.equal(page.requested, false);
    assert.equal(page.video.muted, false);
    assert.equal(extension.messages.filter(message => message.type === 'start').length, 0);
  } finally {extension.close();}
});

test('entering an ordinary document retires the previous JOC audio without waiting for a new JOC manifest', async () => {
  const extension = await createExtension();
  try {
    const first = await extension.page('joc-document');
    first.manifest(); first.enable(); await first.active(); first.alwaysEnable();
    const oldRequestId = first.status.requestId;
    const ordinaryPage = await extension.page('ordinary-document');
    ordinaryPage.unavailable(); ordinaryPage.tick();
    await new Promise(setImmediate);
    assert.ok(extension.messages.some(message => message.target === 'offscreen' && message.type === 'disable'), 'document activation must stop the previous audio even without a new candidate');
    await waitFor(() => extension.messages.some(message => message.type === 'offscreen-status' && message.requestId === oldRequestId && message.phase === 'disabled'), 'old audio to stop');
    assert.equal(ordinaryPage.requested, false);
    assert.equal(ordinaryPage.hasCandidate, false);
    assert.equal(ordinaryPage.video.muted, false);
  } finally {extension.close();}
});

test('refresh restoring 141 seconds cancels the obsolete index fetch before starting the seek target', async () => {
  let indexCalls = 0;
  let obsoleteIndexStarted = false;
  let obsoleteIndexAborted = false;
  const extension = await createExtension({segments: 80, onFetchIndex: ({signal}) => {
    indexCalls += 1;
    if (indexCalls !== 2) return;
    obsoleteIndexStarted = true;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        obsoleteIndexAborted = true;
        reject(new Error('obsolete page-context index cancelled'));
      }, {once: true});
    });
  }});
  try {
    const first = await extension.page('first-document');
    first.manifest(); first.enable(); await first.active(); first.alwaysEnable();
    const next = await extension.page('refresh-document');
    next.manifest();
    await waitFor(() => obsoleteIndexStarted, 'initial zero-second index request');
    next.video.currentTime = 141; next.video.seeking = true; next.event('seeking'); next.tick();
    await new Promise(setImmediate);
    next.video.seeking = false; next.event('seeked'); next.tick();
    await new Promise(setImmediate);
    assert.ok(obsoleteIndexAborted, 'replacement startup must cancel the obsolete fetch instead of queuing behind it');
    await next.active();
    assert.ok(next.requested);
  } finally {extension.close();}
});

test('seek-in-progress clocks cannot restart the old request before seeked dispatches a new request', async () => {
  const extension = await createExtension();
  try {
    const page = await extension.page('same-document');
    page.manifest(); page.enable(); await page.active();
    const baseline = extension.messages.filter(message => message.target === 'offscreen' && message.type === 'start').length;
    page.video.seeking = true; page.video.currentTime = 1; page.event('seeking'); page.tick();
    await new Promise(setImmediate);
    assert.equal(extension.messages.filter(message => message.target === 'offscreen' && message.type === 'start').length, baseline);
    page.video.seeking = false; page.event('seeked'); page.tick();
    await page.active();
  } finally {extension.close();}
});

for (const mode of ['unity', 'calibrated']) {
  test(`selected ${mode} persists across refresh in both the control and automatic decoder start`, async () => {
    const extension = await createExtension({preferences: {dialnormMode: mode === 'unity' ? 'calibrated' : 'unity'}});
    try {
      const first = await extension.page('first-document');
      first.manifest(); first.enable(); await first.active();
      first.dialnorm(mode); first.alwaysEnable();
      await new Promise(setImmediate);
      const baseline = extension.messages.length;
      const next = await extension.page('refreshed-document');
      assert.equal(next.uiDialnorm, mode, 'the dropdown restores the saved level policy');
      next.manifest(); await next.active();
      const start = extension.messages.slice(baseline).find(message => message.target === 'offscreen' && message.type === 'start');
      assert.equal(start?.dialnorm, mode, 'the first decoder start uses the saved level policy');
    } finally {extension.close();}
  });
}

test('automatic enable waits for the saved level policy when storage is still loading', async () => {
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  const extension = await createExtension({preferences: {dialnormMode: 'unity', rendererMode: 'binaural'}, beforeReadPreferences: () => gate});
  try {
    const page = await extension.page('slow-storage-document');
    page.manifest(); page.alwaysEnable();
    await new Promise(setImmediate);
    assert.equal(extension.messages.filter(message => message.type === 'start').length, 0, 'no default-calibrated start may race preference loading');
    release(); await page.active();
    assert.equal(page.uiDialnorm, 'unity');
    assert.equal(page.uiRenderer, 'binaural-headphones');
    assert.equal(extension.messages.find(message => message.target === 'offscreen' && message.type === 'start')?.dialnorm, 'unity');
    assert.equal(page.status.metrics.renderer, 'binaural');
  } finally {release(); extension.close();}
});

test('a user level selection made during storage loading is not overwritten by the older saved value', async () => {
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  const extension = await createExtension({preferences: {dialnormMode: 'calibrated'}, beforeReadPreferences: () => gate});
  try {
    const page = await extension.page('slow-storage-document');
    page.manifest(); page.dialnorm('unity'); page.renderer('binaural-headphones');
    release(); await new Promise(setImmediate);
    page.enable(); await page.active();
    assert.equal(page.uiDialnorm, 'unity');
    assert.equal(page.uiRenderer, 'binaural-headphones');
    assert.equal(extension.messages.find(message => message.target === 'offscreen' && message.type === 'start')?.dialnorm, 'unity');
    assert.equal(page.status.metrics.renderer, 'binaural');
  } finally {release(); extension.close();}
});

for (const [selection, renderer] of [['stereo-speakers', 'stereo'], ['binaural-headphones', 'binaural']]) {
  test(`selected ${renderer} output persists across refresh in the control and decoder`, async () => {
    const extension = await createExtension({preferences: {rendererMode: renderer === 'binaural' ? 'stereo' : 'binaural'}});
    try {
      const first = await extension.page('first-document');
      first.manifest(); first.enable(); await first.active();
      first.renderer(selection); first.alwaysEnable();
      await new Promise(setImmediate);
      const baseline = extension.messages.length;
      const next = await extension.page('refreshed-document');
      assert.equal(next.uiRenderer, selection);
      next.manifest(); await next.active();
      assert.equal(extension.messages.slice(baseline).find(message => message.target === 'offscreen' && message.type === 'start')?.renderer, renderer);
      assert.equal(next.status.metrics.renderer, renderer);
    } finally {extension.close();}
  });
}

test('manual enable also uses saved audio settings when clicked before storage finishes', async () => {
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  const extension = await createExtension({preferences: {dialnormMode: 'unity', rendererMode: 'binaural'}, beforeReadPreferences: () => gate});
  try {
    const page = await extension.page('slow-storage-document');
    page.manifest(); page.enable();
    await new Promise(setImmediate);
    assert.equal(extension.messages.filter(message => message.type === 'start').length, 0);
    release(); await page.active();
    assert.equal(page.uiDialnorm, 'unity');
    assert.equal(page.status.metrics.renderer, 'binaural');
  } finally {release(); extension.close();}
});

test('manual disable can cancel an enable deferred until preference loading completes', async () => {
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  const extension = await createExtension({preferences: {alwaysEnableOpenJoc: true, dialnormMode: 'unity'}, beforeReadPreferences: () => gate});
  try {
    const page = await extension.page('slow-storage-document');
    page.manifest(); page.enable(); page.disable();
    release(); await new Promise(setImmediate);
    assert.equal(extension.messages.filter(message => message.type === 'start').length, 0);
    assert.equal(page.requested, false);
  } finally {release(); extension.close();}
});

test('custom output gain updates live with smoothing and no decoder restart, then persists on refresh', async () => {
  const extension = await createExtension();
  try {
    const first = await extension.page('first-document');
    first.manifest(); first.enable(); await first.active(); first.alwaysEnable();
    const starts = extension.messages.filter(message => message.target === 'offscreen' && message.type === 'start').length;
    first.gain(6);
    await waitFor(() => Math.abs(extension.outputGain - 10 ** (6 / 20)) < 1e-9, 'live gain');
    assert.equal(extension.messages.filter(message => message.target === 'offscreen' && message.type === 'start').length, starts);
    assert.equal(extension.gainAutomation.at(-1)?.type, 'target');
    assert.ok(extension.gainAutomation.at(-1)?.constant > 0);
    const next = await extension.page('refreshed-document');
    assert.equal(next.uiGainDb, 6);
    next.manifest(); await next.active();
    assert.ok(Math.abs(extension.outputGain - 10 ** (6 / 20)) < 1e-9);
    next.gain(0);
    await waitFor(() => extension.outputGain === 1, 'gain reset');
    const reset = await extension.page('reset-document');
    assert.equal(reset.uiGainDb, 0);
  } finally {extension.close();}
});
