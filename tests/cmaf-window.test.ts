// pattern: Functional Core

import {selectCmafSegmentWindow} from '../src/cmaf-window.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  const references = Array.from({length: 6}, (_, index) => ({
    byteRangeStart: index * 100,
    byteRangeEnd: index * 100 + 99,
    ptsSamples: index * 240_000,
    durationSamples: 240_000,
  }));
  const selected = selectCmafSegmentWindow({timescale: 48_000, earliestPresentationTime: 0, references}, 480_000, 3);
  assert(selected.length === 3, 'CMAF fetch window is bounded');
  assert(selected[0]?.ptsSamples === 480_000, 'CMAF fetch window starts at target time');
  assert(selectCmafSegmentWindow({timescale: 48_000, earliestPresentationTime: 0, references}, 2_000_000, 3).length === 0, 'out of range target has no window');
}

run();
