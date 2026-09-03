// pattern: Functional Core

import {advanceMediaTimeSamples, estimateMediaTimeSamples} from '../src/video-clock-estimate.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  assert(estimateMediaTimeSamples(48_000, 500, 1) === 72_000, 'one second clock extrapolation advances by the playback rate');
  assert(estimateMediaTimeSamples(48_000, 500, 0.5) === 60_000, 'clock extrapolation respects playback rate');
  assert(estimateMediaTimeSamples(48_000, -1, 1) === 48_000, 'clock extrapolation never moves backwards for stale elapsed time');
  assert(advanceMediaTimeSamples(48_000, 128, true) === 48_128, 'running Worklet clock advances by one render quantum');
  assert(advanceMediaTimeSamples(48_000, 128, false) === 48_000, 'paused Worklet clock remains fixed');
  assert(advanceMediaTimeSamples(null, 128, true) === null, 'unarmed Worklet clock remains unavailable');
}

run();
