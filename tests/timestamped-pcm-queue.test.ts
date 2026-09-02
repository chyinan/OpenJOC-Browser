// pattern: Functional Core

import {TimestampedPcmQueue} from '../src/timestamped-pcm-queue.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  const queue = new TimestampedPcmQueue({sampleRate: 48_000, channels: 2, maxQueuedMs: 100});
  queue.enqueue({ptsSamples: 48_000, samples: new Float32Array([0.1, -0.1])});
  const outputs = [new Float32Array(1), new Float32Array(1)];
  const played = queue.readForMasterClock(outputs, 48_000, 2_400);
  assert(played.type === 'played', 'aligned PCM is played');
  assert(Math.abs((outputs[0]?.[0] ?? 0) - 0.1) < 0.000001 && Math.abs((outputs[1]?.[0] ?? 0) + 0.1) < 0.000001, 'aligned PCM reaches output');
  assert(played.mediaSamples === 48_000, 'played result exposes media time');

  queue.enqueue({ptsSamples: 60_000, samples: new Float32Array([0.3, -0.3])});
  const waitingOutputs = [new Float32Array(1), new Float32Array(1)];
  const waiting = queue.readForMasterClock(waitingOutputs, 48_000, 2_400);
  assert(waiting.type === 'wait', 'future PCM waits for the video master');
  assert(queue.queuedAudioMs() > 0, 'waiting does not consume future PCM');
  assert(waitingOutputs.every((output) => output[0] === 0), 'waiting emits silence');

  const staleQueue = new TimestampedPcmQueue({sampleRate: 48_000, channels: 2, maxQueuedMs: 100});
  staleQueue.enqueue({ptsSamples: 0, samples: new Float32Array([0.4, -0.4])});
  const stale = staleQueue.readForMasterClock([new Float32Array(1), new Float32Array(1)], 10_000, 2_400);
  assert(stale.type === 'trim', 'stale PCM is trimmed');
  assert(staleQueue.queuedAudioMs() === 0, 'trim clears stale PCM');
}

run();
