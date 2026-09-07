// pattern: Functional Core

import {accumulateAudioLevel, averageAudioLevelDb, createAudioLevelAccumulator} from '../src/audio-level.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertClose(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) < 0.01, `${message}: expected ${expected}, got ${actual}`);
}

function run(): void {
  assert(averageAudioLevelDb(createAudioLevelAccumulator()) === null, 'an empty audio level has no dB value');

  const halfScale = accumulateAudioLevel(createAudioLevelAccumulator(), [new Float32Array([0.5, -0.5]), new Float32Array([0.5, -0.5])]);
  assertClose(averageAudioLevelDb(halfScale) ?? Number.NaN, -6.0206, 'half-scale stereo RMS is -6.02 dBFS');

  const mixed = accumulateAudioLevel(createAudioLevelAccumulator(), [new Float32Array([1, 0]), new Float32Array([0, 1])]);
  assertClose(averageAudioLevelDb(mixed) ?? Number.NaN, -3.0103, 'mixed stereo RMS averages channel power');

  const silence = accumulateAudioLevel(createAudioLevelAccumulator(), [new Float32Array([0, 0]), new Float32Array([0, 0])]);
  assertClose(averageAudioLevelDb(silence) ?? Number.NaN, -96, 'silence is clamped to the display floor');
}

run();
