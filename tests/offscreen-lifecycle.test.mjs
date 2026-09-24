// pattern: Imperative Shell

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaybackRuntime, waitFor} from './helpers/extension-runtime.mjs';

test('refresh resets page generation while the existing audio pipeline accepts new PCM', async () => {
  const runtime = await createPlaybackRuntime();
  try {
    runtime.start(8, 'before-refresh');
    await runtime.active('before-refresh');
    runtime.start(1, 'after-refresh');
    const active = await runtime.active('after-refresh');
    assert.ok(active.metrics.decodedAccessUnits > 0);
    assert.ok(active.metrics.currentAudioMediaTime !== null);
  } finally {
    runtime.close();
  }
});

test('renderer and HRTF changes reuse the active media index and native mute state', async () => {
  let indexRequests = 0;
  const runtime = await createPlaybackRuntime({
    onFetchIndex() {
      indexRequests += 1;
    },
  });
  try {
    runtime.start(1, 'speaker-mode');
    await runtime.active('speaker-mode');

    runtime.start(1, 'binaural-d1', 'A', 1, {renderer: 'binaural', hrtf: 'sadie-ii-d1-ku100'});
    await runtime.active('binaural-d1');
    assert.equal(runtime.messages.some(message => message.requestId === 'binaural-d1' && message.phase === 'ready'), false);

    runtime.start(1, 'binaural-d2', 'A', 1, {renderer: 'binaural', hrtf: 'sadie-ii-d2-kemar'});
    await runtime.active('binaural-d2');
    assert.equal(runtime.messages.some(message => message.requestId === 'binaural-d2' && message.phase === 'ready'), false);
    assert.equal(indexRequests, 1, 'renderer changes should not refetch the unchanged media index');
  } finally {
    runtime.close();
  }
});

test('fetches a fresh media index when the signed candidate URLs change', async () => {
  let indexRequests = 0;
  const runtime = await createPlaybackRuntime({
    onFetchIndex() {
      indexRequests += 1;
    },
  });
  try {
    runtime.start(1, 'speaker-signed-url');
    await runtime.active('speaker-signed-url');
    const refreshedCandidate = {
      id: 'dolby', source: 'dolby', codecs: 'ec-3', mimeType: 'audio/mp4', bandwidth: 1_000_000,
      baseUrl: 'https://media.bilivideo.com/refreshed-audio.m4s', backupUrls: [],
    };
    runtime.start(1, 'binaural-refreshed-url', 'A', 1, {renderer: 'binaural', candidate: refreshedCandidate});
    await runtime.active('binaural-refreshed-url');
    assert.equal(indexRequests, 2, 'a refreshed signed URL must get its own current index');
  } finally {
    runtime.close();
  }
});

test('keeps the active AudioContext running during an in-place renderer change', async () => {
  let suspendCalls = 0;
  let resumeCalls = 0;
  const runtime = await createPlaybackRuntime({
    onAudioContextResume() {
      resumeCalls += 1;
    },
    onAudioContextSuspend() {
      suspendCalls += 1;
    },
  });
  try {
    runtime.start(1, 'speaker-before-transition');
    await runtime.active('speaker-before-transition');
    const resumesBeforeTransition = resumeCalls;

    runtime.start(1, 'binaural-after-transition', 'A', 1, {renderer: 'binaural', hrtf: 'sadie-ii-d1-ku100'});
    await runtime.active('binaural-after-transition');
    assert.equal(suspendCalls, 0, 'an active media transition should not suspend the shared AudioContext');
    assert.equal(resumeCalls, resumesBeforeTransition, 'an already-running AudioContext should not be resumed again');
  } finally {
    runtime.close();
  }
});

test('starts binaural HRTF loading while the first replacement segment is still fetching', async () => {
  let releaseSegment;
  let markSegmentStarted;
  let shouldBlockSegment = false;
  let hrtfAssetRequested = false;
  const segmentGate = new Promise(resolve => {releaseSegment = resolve;});
  const segmentStarted = new Promise(resolve => {markSegmentStarted = resolve;});
  const runtime = await createPlaybackRuntime({
    segments: 1,
    async onFetchSegment() {
      if (!shouldBlockSegment) return undefined;
      shouldBlockSegment = false;
      markSegmentStarted();
      await segmentGate;
      return undefined;
    },
    onHrtfAssetFetch() {
      hrtfAssetRequested = true;
    },
  });
  try {
    runtime.start(1, 'speaker-before-preparation');
    await runtime.active('speaker-before-preparation');
    shouldBlockSegment = true;
    runtime.start(1, 'binaural-preparation', 'A', 1, {renderer: 'binaural', hrtf: 'sadie-ii-d1-ku100'});
    await segmentStarted;
    await waitFor(() => hrtfAssetRequested, 'the HRTF asset fetch to begin before the segment fetch completes', 2_000);
    releaseSegment();
    await runtime.active('binaural-preparation');
  } finally {
    releaseSegment();
    runtime.close();
  }
});

test('automatic next item replaces a running decoder without a disable-enable click', async () => {
  const runtime = await createPlaybackRuntime();
  try {
    runtime.start(1, 'item-a');
    await runtime.active('item-a');
    runtime.start(2, 'item-b', 'B');
    const active = await runtime.active('item-b');
    assert.equal(active.mediaKey.bvid, 'BVB');
    assert.ok(active.metrics.decodedAccessUnits > 0);
  } finally {
    runtime.close();
  }
});

test('five refreshes and next-item transitions accept PCM without manual recovery', async () => {
  const runtime = await createPlaybackRuntime();
  try {
    for (let index = 0; index < 5; index += 1) {
      const requestId = `refresh-${index}`;
      runtime.start(1, requestId, `item-${index}`);
      await runtime.active(requestId);
    }
    assert.equal(runtime.messages.filter(message => message.phase === 'error').length, 0);
  } finally {
    runtime.close();
  }
});

test('replacement can start while the old paused decoder is waiting on a full PCM queue', async () => {
  const runtime = await createPlaybackRuntime();
  try {
    runtime.start(1, 'paused-item');
    await runtime.active('paused-item');
    runtime.dispatch({target: 'offscreen', type: 'clock', tabId: 1, generation: 1, mediaTimeSamples: 0, paused: true, buffering: false, playbackRate: 1, expectedDisplayTimeMs: null});
    await waitFor(() => runtime.workletStats.some(stats => stats.queuedAudioMs > 3000), 'paused PCM queue to fill');
    runtime.start(1, 'new-item', 'B');
    await runtime.active('new-item');
  } finally {
    runtime.close();
  }
});

test('resuming after two idle minutes does not expire an intentionally paused decoder', async () => {
  const runtime = await createPlaybackRuntime({segments: 4});
  try {
    runtime.start(1, 'long-pause');
    await runtime.active('long-pause');
    const clock = {target: 'offscreen', type: 'clock', tabId: 1, generation: 1, mediaTimeSamples: 48000, paused: true, buffering: false, playbackRate: 1, expectedDisplayTimeMs: null};
    runtime.dispatch(clock);
    await waitFor(() => runtime.workletStats.some(stats => stats.queuedAudioMs > 3000), 'paused full queue');
    runtime.dispatch(clock);
    await new Promise(setImmediate);
    runtime.elapseIdle(120_000);
    runtime.dispatch({...clock, paused: false});
    await new Promise(setImmediate);
    assert.equal(runtime.messages.filter(message => message.phase === 'error').length, 0, 'pause time must not consume the decoder progress deadline on resume');
    const samples = runtime.pcmMessages.length;
    await waitFor(() => runtime.pcmMessages.length > samples, 'PCM to continue after resume');
  } finally {
    runtime.close();
  }
});

test('an already paused start keeps the audio worklet silent until the video resumes', async () => {
  const runtime = await createPlaybackRuntime({autoReady: false});
  try {
    runtime.start(1, 'paused-start', 'A', 1, {paused: true});
    await waitFor(() => runtime.messages.some(message => message.requestId === 'paused-start' && message.phase === 'ready'), 'paused startup to become ready');
    runtime.dispatch({target: 'offscreen', type: 'native-muted', tabId: 1, generation: 1});
    await waitFor(() => runtime.messages.some(message => message.requestId === 'paused-start' && message.phase === 'paused'), 'paused startup to remain paused');
    await waitFor(() => runtime.renderedQuantumCount >= 40, 'paused worklet render quanta');
    assert.equal(runtime.workletStats.at(-1)?.playedQuantumCount, 0);
    runtime.dispatch({target: 'offscreen', type: 'clock', tabId: 1, generation: 1, mediaTimeSamples: 0, paused: false, buffering: false, playbackRate: 1, expectedDisplayTimeMs: null});
    await waitFor(() => runtime.messages.some(message => message.requestId === 'paused-start' && message.phase === 'active'), 'resumed worklet playback');
    await waitFor(() => runtime.workletStats.some(stats => stats.generation === 1 && stats.playedQuantumCount > 0), 'resumed worklet output');
  } finally {
    runtime.close();
  }
});

test('an excessive audio lead is rebuilt from the next authoritative video clock', async () => {
  const runtime = await createPlaybackRuntime();
  try {
    runtime.start(1, 'lead-recovery');
    await runtime.active('lead-recovery');
    const previousAudioGeneration = runtime.workletStats.at(-1)?.generation;
    assert.ok(previousAudioGeneration !== undefined);
    const previousStats = runtime.workletStats.at(-1);
    runtime.emitWorkletStats({...previousStats, currentAudioMediaSamples: 120_000, driftMs: 2_500});
    await new Promise(resolve => queueMicrotask(resolve));
    assert.equal(runtime.messages.at(-1)?.metrics.driftMs, 2_500);
    const preparingCount = runtime.messages.filter(message => message.requestId === 'lead-recovery' && message.phase === 'preparing').length;
    runtime.dispatch({target: 'offscreen', type: 'clock', tabId: 1, generation: 1, mediaTimeSamples: 0, paused: true, buffering: false, playbackRate: 1, expectedDisplayTimeMs: null});
    await waitFor(() => runtime.messages.filter(message => message.requestId === 'lead-recovery' && message.phase === 'preparing').length > preparingCount, 'new preparation after excessive lead', 2_000);
  } finally {
    runtime.close();
  }
});

test('a large foreground video jump rebuilds audio from the current video position', async () => {
  const runtime = await createPlaybackRuntime({autoReady: false, segments: 20});
  try {
    runtime.start(1, 'foreground-jump');
    await waitFor(() => runtime.messages.some(message => message.requestId === 'foreground-jump' && message.phase === 'ready'), 'initial foreground-jump readiness');
    runtime.dispatch({target: 'offscreen', type: 'native-muted', tabId: 1, generation: 1});
    await runtime.active('foreground-jump');
    const preparingCount = runtime.messages.filter(message => message.requestId === 'foreground-jump' && message.phase === 'preparing').length;
    const activeCount = runtime.messages.filter(message => message.requestId === 'foreground-jump' && message.phase === 'active').length;
    runtime.elapseIdle(24_000);
    runtime.dispatch({target: 'offscreen', type: 'clock', tabId: 1, generation: 1, mediaTimeSamples: 24 * 48000, paused: false, buffering: false, playbackRate: 1, expectedDisplayTimeMs: null});
    await waitFor(() => runtime.messages.filter(message => message.requestId === 'foreground-jump' && message.phase === 'preparing').length > preparingCount, 'audio restart after a large foreground video jump');
    await waitFor(() => runtime.messages.filter(message => message.requestId === 'foreground-jump' && message.phase === 'active').length > activeCount, 'audio reactivation without a second native mute acknowledgement', 2_000);
  } finally {
    runtime.close();
  }
});

test('a recent foreground clock does not rebuild for normal CMAF segment offset', async () => {
  const runtime = await createPlaybackRuntime();
  try {
    runtime.start(1, 'recent-clock');
    await runtime.active('recent-clock');
    const previousStats = runtime.workletStats.at(-1);
    assert.ok(previousStats !== undefined);
    runtime.emitWorkletStats({...previousStats, currentAudioMediaSamples: 0, driftMs: -2_500});
    await new Promise(resolve => queueMicrotask(resolve));
    const preparingCount = runtime.messages.filter(message => message.requestId === 'recent-clock' && message.phase === 'preparing').length;
    runtime.dispatch({target: 'offscreen', type: 'clock', tabId: 1, generation: 1, mediaTimeSamples: 120_000, paused: false, buffering: false, playbackRate: 1, expectedDisplayTimeMs: null});
    await new Promise(setImmediate);
    assert.equal(runtime.messages.filter(message => message.requestId === 'recent-clock' && message.phase === 'preparing').length, preparingCount);
  } finally {
    runtime.close();
  }
});

test('AudioWorklet status drives prefetch while minimized-window timers are suspended', async () => {
  const runtime = await createPlaybackRuntime({segments: 10, accessUnitsPerSegment: 8, windowIntervalsSuspended: true});
  try {
    runtime.start(1, 'minimized-prefetch');
    await runtime.active('minimized-prefetch');
    await waitFor(() => runtime.pcmMessages.length > 16, 'worklet-driven prefetch beyond the initial two-segment window', 2_000);
  } finally {
    runtime.close();
  }
});

test('a new tab retires the old tab and rejects its clock even when page generations match', async () => {
  const runtime = await createPlaybackRuntime();
  try {
    runtime.start(1, 'tab-a', 'A', 1);
    await runtime.active('tab-a');
    runtime.start(1, 'tab-b', 'B', 2);
    await runtime.active('tab-b');
    runtime.dispatch({target: 'offscreen', type: 'clock', tabId: 1, generation: 1, mediaTimeSamples: 25 * 48000, paused: true, buffering: false, playbackRate: 1, expectedDisplayTimeMs: null});
    await new Promise(setImmediate);
    assert.deepEqual({
      oldTabRetired: runtime.messages.some(message => message.requestId === 'tab-a' && message.phase === 'disabled'),
      newTabPausedByOldClock: runtime.messages.some(message => message.requestId === 'tab-b' && message.phase === 'paused'),
    }, {oldTabRetired: true, newTabPausedByOldClock: false});
  } finally {
    runtime.close();
  }
});

test('a timed-out CMAF segment falls back to the next manifest mirror', async () => {
  const primary = 'https://upos-hz-mirrorakam.akamaized.net/audio.m4s';
  const backup = 'https://upos-sz-mirrorcosov.bilivideo.com/audio.m4s';
  const requestedUrls = [];
  const runtime = await createPlaybackRuntime({
    candidate: {id: 'dolby', source: 'dolby', codecs: 'ec-3', mimeType: 'audio/mp4', bandwidth: 1000000, baseUrl: primary, backupUrls: [backup]},
    onFetchSegment(session) {
      requestedUrls.push(session.url);
      if (session.url === primary) throw new Error('Bilibili CMAF range request timed out for bytes 100-200');
    },
  });
  try {
    runtime.start(1, 'segment-fallback');
    try {
      await runtime.active('segment-fallback');
    } catch (error) {
      throw new Error(`${error.message}; requested=${requestedUrls.join(',')}`);
    }
    assert.deepEqual(requestedUrls, [primary, backup, backup], 'a timed-out primary segment advances to the next mirror and stays there');
  } finally {
    runtime.close();
  }
});

test('a 403 CMAF segment can fall back through the page context', async () => {
  const primary = 'https://upos-hz-mirrorakam.akamaized.net/audio.m4s';
  const pageRequests = [];
  const runtime = await createPlaybackRuntime({
    segments: 1,
    candidate: {id: 'dolby', source: 'dolby', codecs: 'ec-3', mimeType: 'audio/mp4', bandwidth: 1000000, baseUrl: primary, backupUrls: []},
    onFetchSegment() {
      throw new Error('Bilibili CMAF range request returned status 403 for bytes 0-4095');
    },
    onPageRangeRequest(message, dispatch) {
      pageRequests.push(message.url);
      dispatch({target: 'offscreen', type: 'page-media-range-response', tabId: message.tabId, generation: message.generation, requestId: message.requestId, status: 206, contentRange: null, error: null, bufferBase64: btoa(String.fromCharCode(...new Uint8Array(4096).fill(1)))});
    },
  });
  try {
    runtime.start(1, 'segment-page-fallback');
    await waitFor(() => runtime.messages.some(message => message.requestId === 'segment-page-fallback' && message.phase === 'active'), 'page-context fallback playback');
    assert.deepEqual(pageRequests, [primary], 'a 403 segment uses the exact current URL through page context');
  } finally {
    runtime.close();
  }
});

test('a failed 403 page-context fallback advances to the next manifest mirror', async () => {
  const primary = 'https://upos-hz-mirrorakam.akamaized.net/audio.m4s';
  const backup = 'https://upos-sz-mirrorcosov.bilivideo.com/audio.m4s';
  const requestedUrls = [];
  const pageRequests = [];
  const runtime = await createPlaybackRuntime({
    candidate: {id: 'dolby', source: 'dolby', codecs: 'ec-3', mimeType: 'audio/mp4', bandwidth: 1000000, baseUrl: primary, backupUrls: [backup]},
    onFetchSegment(session) {
      requestedUrls.push(session.url);
      if (session.url === primary) throw new Error('Bilibili CMAF range request returned status 403 for bytes 0-4095');
    },
    onPageRangeRequest(message, dispatch) {
      pageRequests.push(message.url);
      dispatch({target: 'offscreen', type: 'page-media-range-response', tabId: message.tabId, generation: message.generation, requestId: message.requestId, status: 500, contentRange: null, error: 'page fallback unavailable', bufferBase64: ''});
    },
  });
  try {
    runtime.start(1, 'segment-page-fallback-next');
    await runtime.active('segment-page-fallback-next');
    assert.deepEqual(pageRequests, [primary], 'a 403 segment attempts the exact current URL through page context before changing mirrors');
    assert.deepEqual(requestedUrls.slice(0, 2), [primary, backup], 'a failed page fallback continues to the next mirror');
  } finally {
    runtime.close();
  }
});
