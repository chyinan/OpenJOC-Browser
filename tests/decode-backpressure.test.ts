// pattern: Functional Core

import {MAX_CMAF_DECODE_QUEUE_MS, shouldWaitForCmafAudioBudget} from '../src/decode-backpressure.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  assert(MAX_CMAF_DECODE_QUEUE_MS === 3_000, 'background CMAF playback keeps a three-second PCM cushion');
  assert(!shouldWaitForCmafAudioBudget(0, 1_000), 'CMAF decoder can prepare with an empty queue');
  assert(!shouldWaitForCmafAudioBudget(1_000, 1_000), 'CMAF decoder can reach the queue boundary');
  assert(shouldWaitForCmafAudioBudget(1_000.1, 1_000), 'CMAF decoder waits only after the queue budget');
}

run();
