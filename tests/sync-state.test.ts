// pattern: Functional Core

import {advanceSyncState, computeSyncAction, createDriftMetrics, createSyncState, recordDriftSample, type SyncEvent} from '../src/sync-state.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function apply(state: ReturnType<typeof createSyncState>, event: SyncEvent): ReturnType<typeof createSyncState> {
  return advanceSyncState(state, event);
}

function run(): void {
  let state = createSyncState();
  state = apply(state, {type: 'enable', generation: 4, mediaKey: 'bvid:cid', mediaTimeSamples: 720_000});
  assert(state.phase === 'preparing', 'enable prepares at the current video time');
  assert(state.targetMediaSamples === 720_000, 'enable anchors to current video time');

  state = apply(state, {type: 'ready', generation: 4});
  assert(state.phase === 'active', 'ready activates OpenJOC');
  state = apply(state, {type: 'video-clock', generation: 4, mediaTimeSamples: 721_000, paused: true, buffering: false, playbackRate: 1});
  assert(state.phase === 'paused', 'paused video pauses OpenJOC');
  state = apply(state, {type: 'video-clock', generation: 4, mediaTimeSamples: 721_000, paused: false, buffering: false, playbackRate: 1});
  assert(state.phase === 'active', 'resumed video resumes OpenJOC');
  state = apply(state, {type: 'video-clock', generation: 4, mediaTimeSamples: 722_000, paused: false, buffering: true, playbackRate: 1});
  assert(state.phase === 'buffering', 'buffering video stops audio advancement');
  assert(computeSyncAction(state, 723_000).type === 'wait', 'buffering never runs audio ahead');

  state = apply(state, {type: 'seek', generation: 5, mediaTimeSamples: 1_440_000});
  assert(state.generation === 5 && state.phase === 'preparing', 'seek creates a new preparation generation');
  assert(state.targetMediaSamples === 1_440_000, 'seek reanchors target media time');
  const stale = apply(state, {type: 'video-clock', generation: 4, mediaTimeSamples: 0, paused: false, buffering: false, playbackRate: 1});
  assert(stale.targetMediaSamples === 1_440_000, 'stale video clock cannot move the new generation');

  state = apply(state, {type: 'ready', generation: 5});
  const early = computeSyncAction(state, 1_430_000);
  assert(early.type === 'wait', 'audio that is behind waits for the video master');
  const late = computeSyncAction(state, 1_450_000);
  assert(late.type === 'trim' && late.targetMediaSamples === 1_440_000, 'audio ahead is trimmed toward video');
  state = apply(state, {type: 'video-clock', generation: 5, mediaTimeSamples: 1_440_000, paused: false, buffering: false, playbackRate: 1.5});
  assert(state.phase === 'disabled' && state.fallbackReason === 'unsupported playback rate', 'non-1x falls back safely');

  let drift = createDriftMetrics();
  for (const value of [1, 4, 9, 16, 25]) drift = recordDriftSample(drift, value);
  assert(drift.p50Ms === 9, 'drift p50 uses absolute samples');
  assert(drift.p95Ms === 25 && drift.maxMs === 25, 'drift p95 and max use bounded samples');
}

run();
