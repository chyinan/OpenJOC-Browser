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
