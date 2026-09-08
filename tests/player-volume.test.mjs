// pattern: Imperative Shell

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaybackRuntime, createSourceRuntime} from './helpers/extension-runtime.mjs';
import {createNativeAudioRuntime} from './helpers/native-audio-runtime.mjs';

test('native controls retain logical mute while the original audio stays suppressed', async () => {
  const bridge = await createNativeAudioRuntime();
  const {video} = bridge;
  video.dataset.openjocAudioToken = 'video';
  video.volume = 0.7;
  const owner = {source: 'openjoc-content', type: 'take-audio-control', token: 'video', requestId: 'request', generation: 1};
  bridge.dispatch(owner);
  assert.equal(bridge.physicalMuted(), true);
  assert.equal(video.muted, false, 'the Bilibili button sees the user state, not forced native suppression');
  video.muted = !video.muted;
  assert.equal(bridge.events.at(-1).muted, true);
  video.muted = !video.muted;
  video.volume = 0.3;
  assert.equal(bridge.events.at(-1).volume, 0.3);
  assert.equal(bridge.events.at(-1).muted, false);
  assert.equal(bridge.physicalMuted(), true);
  bridge.dispatch({...owner, type: 'release-audio-control'});
  assert.equal(bridge.physicalMuted(), false);
  assert.equal(video.volume, 0.3, 'release retains the latest user volume');
  assert.equal(Object.hasOwn(video, 'muted'), false);
});

test('replacement ownership rejects late releases and keeps the user mute setting', async () => {
  const bridge = await createNativeAudioRuntime();
  bridge.video.dataset.openjocAudioToken = 'video';
  bridge.video.muted = true;
  const owner = {source: 'openjoc-content', type: 'take-audio-control', token: 'video', requestId: 'old', generation: 1};
  bridge.dispatch(owner);
  bridge.dispatch({...owner, requestId: 'new', generation: 2});
  bridge.dispatch({...owner, type: 'release-audio-control'});
  assert.equal(Object.hasOwn(bridge.video, 'muted'), true);
  bridge.dispatch({...owner, type: 'release-audio-control', requestId: 'new', generation: 2});
  assert.equal(bridge.video.muted, true);
});

test('player volume and mute control output independently of custom gain', async () => {
  const playback = await createPlaybackRuntime();
  try {
    playback.start(1, 'volume'); await playback.active('volume');
    const control = {target: 'offscreen', type: 'player-volume', requestId: 'volume', tabId: 1, generation: 1, volume: 0.25, muted: false, activate: true};
    playback.dispatch(control);
    assert.equal(playback.outputGain, 0.25);
    playback.dispatch({target: 'offscreen', type: 'output-gain', requestId: 'volume', tabId: 1, generation: 1, gainDb: 6});
    assert.ok(Math.abs(playback.outputGain - 0.25 * 10 ** (6 / 20)) < 1e-9);
    playback.dispatch({...control, muted: true, activate: false});
    assert.equal(playback.outputGain, 0);
    playback.dispatch({target: 'offscreen', type: 'output-gain', requestId: 'volume', tabId: 1, generation: 1, gainDb: 20});
    assert.equal(playback.outputGain, 0);
    playback.dispatch({...control, volume: 0.5, activate: false});
    assert.ok(Math.abs(playback.outputGain - 0.5 * 10 ** (20 / 20)) < 1e-9);
    playback.dispatch({...control, requestId: 'stale', volume: 1});
    playback.dispatch({...control, tabId: 2, volume: 1});
    assert.ok(Math.abs(playback.outputGain - 0.5 * 10 ** (20 / 20)) < 1e-9);
  } finally {playback.close();}
});

test('a preexisting mute accessor is not overwritten and takeover fails closed', async () => {
  const bridge = await createNativeAudioRuntime();
  bridge.video.dataset.openjocAudioToken = 'video';
  const getter = () => false;
  Object.defineProperty(bridge.video, 'muted', {get: getter, configurable: false});
  bridge.dispatch({source: 'openjoc-content', type: 'take-audio-control', token: 'video', requestId: 'request', generation: 1});
  assert.equal(bridge.events.at(-1).suppressed, false);
  assert.equal(bridge.physicalMuted(), false);
  assert.equal(Object.getOwnPropertyDescriptor(bridge.video, 'muted').get, getter);
});

test('player volume messages reject malformed and out-of-range controls', async () => {
  const {isRuntimeMessage} = await createSourceRuntime().load('extension-protocol.js');
  const control = {target: 'background', type: 'player-volume', requestId: 'volume', generation: 1, volume: 0.5, muted: false, activate: true};
  assert.equal(isRuntimeMessage(control), true);
  for (const volume of [-1, 1.1, NaN, Infinity, '0.5']) assert.equal(isRuntimeMessage({...control, volume}), false);
  assert.equal(isRuntimeMessage({...control, muted: 1}), false);
  assert.equal(isRuntimeMessage({...control, requestId: ''}), false);
});
