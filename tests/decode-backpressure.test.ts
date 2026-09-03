// pattern: Functional Core

import {shouldWaitForCmafAudioBudget} from '../src/decode-backpressure.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  assert(!shouldWaitForCmafAudioBudget(0, 1_000), 'CMAF decoder can prepare with an empty queue');
  assert(!shouldWaitForCmafAudioBudget(1_000, 1_000), 'CMAF decoder can reach the queue boundary');
  assert(shouldWaitForCmafAudioBudget(1_000.1, 1_000), 'CMAF decoder waits only after the queue budget');
}

run();
