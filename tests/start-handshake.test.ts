// pattern: Functional Core

import {acknowledgeStart, createStartHandshake, nextStartHandshakeAction, recordStartAttempt, shouldAcceptPlaybackStatus, shouldDispatchSessionRecovery, shouldExpirePlaybackStatus, shouldRestartAfterSeek} from '../src/start-handshake.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  let state = createStartHandshake();
  assert(nextStartHandshakeAction(state, 10_000, 35_000) === 'wait', 'an unsent start remains idle');

  state = recordStartAttempt(state, 1_000);
  assert(nextStartHandshakeAction(state, 35_999, 35_000) === 'wait', 'a cold start keeps one request alive while the offscreen decoder prepares');
  assert(nextStartHandshakeAction(state, 36_000, 35_000) === 'give-up', 'a start gives up only after the offscreen preparation deadline');

  state = acknowledgeStart(state);
  assert(nextStartHandshakeAction(state, 99_000, 35_000) === 'wait', 'an acknowledged start never expires');

  const recoveringStart = recordStartAttempt(recordStartAttempt(createStartHandshake(), 1_000), 34_000);
  assert(nextStartHandshakeAction(recoveringStart, 36_000, 35_000) === 'give-up', 'recovery cannot extend the original startup deadline indefinitely');

  const pendingStart = recordStartAttempt(createStartHandshake(), 1_000);
  assert(!shouldDispatchSessionRecovery(false, pendingStart), 'an ordinary heartbeat does not replace a pending start request');
  assert(shouldDispatchSessionRecovery(true, pendingStart), 'an offscreen rebuild can force a replacement start request');
  assert(shouldDispatchSessionRecovery(false, createStartHandshake()), 'a missing session can be requested before a start attempt exists');
  assert(shouldDispatchSessionRecovery(false, acknowledgeStart(pendingStart)), 'a lost acknowledged session can be requested again');

  assert(shouldRestartAfterSeek(true, true), 'a completed pending seek restarts an active OpenJOC session');
  assert(!shouldRestartAfterSeek(false, true), 'a disabled session does not restart after seek');
  assert(!shouldRestartAfterSeek(true, false), 'a stray seeked event does not duplicate the current session');

  assert(shouldAcceptPlaybackStatus('request-b', 'media-b', 'request-b', 'media-b'), 'status from the active request and media is accepted');
  assert(!shouldAcceptPlaybackStatus(null, 'media-b', 'request-a', 'media-b'), 'status arriving before a current request is rejected');
  assert(!shouldAcceptPlaybackStatus('request-b', 'media-b', 'request-a', 'media-b'), 'status from a replaced request is rejected');
  assert(!shouldAcceptPlaybackStatus('request-b', 'media-b', 'request-b', 'media-a'), 'status from a replaced media item is rejected');

  assert(shouldExpirePlaybackStatus({requested: true, hasStatus: true, isStreaming: false, documentVisible: true, videoPaused: false, videoSeeking: false, elapsedMs: 4_000, timeoutMs: 4_000}), 'a visible playing session with stale preparation status expires');
  assert(!shouldExpirePlaybackStatus({requested: true, hasStatus: true, isStreaming: true, documentVisible: true, videoPaused: false, videoSeeking: false, elapsedMs: 40_000, timeoutMs: 4_000}), 'a streaming decoder is not disabled by a content timer delay');
  assert(!shouldExpirePlaybackStatus({requested: true, hasStatus: true, isStreaming: false, documentVisible: true, videoPaused: true, videoSeeking: false, elapsedMs: 40_000, timeoutMs: 4_000}), 'a paused session is not expired by timer throttling');
  assert(!shouldExpirePlaybackStatus({requested: true, hasStatus: true, isStreaming: false, documentVisible: false, videoPaused: false, videoSeeking: false, elapsedMs: 40_000, timeoutMs: 4_000}), 'a hidden session is not expired by timer throttling');
  assert(!shouldExpirePlaybackStatus({requested: true, hasStatus: true, isStreaming: false, documentVisible: true, videoPaused: false, videoSeeking: true, elapsedMs: 40_000, timeoutMs: 4_000}), 'a seeking session is not expired while its clock is discontinuous');
}

run();
