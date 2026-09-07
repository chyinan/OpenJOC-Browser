// pattern: Functional Core

import {advanceDecoderProgressWatchdog, createDecoderProgressWatchdog, hasDecoderMadeProgress} from '../src/decode-progress.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  let watchdog = createDecoderProgressWatchdog({timeoutMs: 10_000, nowMs: 0});
  watchdog = advanceDecoderProgressWatchdog({watchdog, nowMs: 9_000, isPaused: false}).state;
  const paused = advanceDecoderProgressWatchdog({watchdog, nowMs: 60_000, isPaused: true});
  assert(!paused.expired, 'paused decoding does not expire the progress watchdog');
  assert(paused.state.remainingMs === 1_000, 'watchdog preserves active time before pause');
  const resumed = advanceDecoderProgressWatchdog({watchdog: paused.state, nowMs: 180_000, isPaused: false});
  assert(!resumed.expired, 'resumed decoding keeps the remaining watchdog budget');
  assert(resumed.state.remainingMs === 1_000, 'a long paused interval is not charged when playback resumes');
  assert(advanceDecoderProgressWatchdog({watchdog: resumed.state, nowMs: 181_000, isPaused: false}).expired, 'watchdog expires after active time is exhausted');
  assert(!hasDecoderMadeProgress(12, 12), 'an unchanged access-unit count is not progress');
  assert(hasDecoderMadeProgress(12, 13), 'one completed access unit is sufficient progress for a whole submitted CMAF batch');
}

run();
