import {PcmQueue} from '../src/audio-queue.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertClose(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) < 0.000001, `${message}: ${actual} !== ${expected}`);
}

function run(): void {
  const queue = new PcmQueue({sampleRate: 48_000, channels: 2, maxQueuedMs: 100});
  const block = new Float32Array([0.1, -0.1, 0.2, -0.2]);

  queue.enqueue(block);
  assertClose(queue.queuedAudioMs(), 2 * 1000 / 48_000, 'queued duration');

  const outputs = [new Float32Array(2), new Float32Array(2)];
  queue.read(outputs);
  assertClose(outputs[0]?.[0] ?? 0, 0.1, 'left sample 0');
  assertClose(outputs[1]?.[0] ?? 0, -0.1, 'right sample 0');
  assertClose(outputs[0]?.[1] ?? 0, 0.2, 'left sample 1');
  assertClose(outputs[1]?.[1] ?? 0, -0.2, 'right sample 1');
  assertClose(queue.queuedAudioMs(), 0, 'empty duration');

  queue.read(outputs);
  assert(queue.underrunCount() === 1, 'empty read increments one underrun');
  assert(outputs.every((output) => output.every((sample) => sample === 0)), 'empty read is silence');

  queue.enqueue(new Float32Array([0.3, -0.3]));
  queue.reset();
  queue.read(outputs);
  assert(queue.underrunCount() === 1, 'reset clears queued stale data');
  assert(outputs.every((output) => output.every((sample) => sample === 0)), 'reset emits silence');

  const terminalQueue = new PcmQueue({sampleRate: 48_000, channels: 2, maxQueuedMs: 100});
  terminalQueue.enqueue(new Float32Array([0.4, -0.4]));
  terminalQueue.read([new Float32Array(128), new Float32Array(128)], true);
  assert(terminalQueue.underrunCount() === 0, 'terminal partial quantum is not an underrun');
}

run();
