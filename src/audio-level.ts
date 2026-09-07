// pattern: Functional Core

export const AUDIO_LEVEL_FLOOR_DB = -96;

export type AudioLevelAccumulator = Readonly<{
  readonly powerSum: number;
  readonly sampleCount: number;
}>;

export function createAudioLevelAccumulator(): AudioLevelAccumulator {
  return {powerSum: 0, sampleCount: 0};
}

/** Adds interleaved channel samples without mutating the accumulator or input arrays. */
export function accumulateAudioLevel(
  accumulator: Readonly<AudioLevelAccumulator>,
  channels: ReadonlyArray<Float32Array>,
): AudioLevelAccumulator {
  let powerSum = accumulator.powerSum;
  let sampleCount = accumulator.sampleCount;
  for (const channel of channels) {
    for (const sample of channel) {
      if (!Number.isFinite(sample)) continue;
      const boundedSample = Math.min(1, Math.max(-1, sample));
      powerSum += boundedSample * boundedSample;
      sampleCount += 1;
    }
  }
  return {powerSum, sampleCount};
}

/** Converts the accumulated RMS power to dBFS, with a finite silence floor. */
export function averageAudioLevelDb(accumulator: Readonly<AudioLevelAccumulator>): number | null {
  if (accumulator.sampleCount === 0) return null;
  const meanSquare = accumulator.powerSum / accumulator.sampleCount;
  if (!Number.isFinite(meanSquare) || meanSquare <= 0) return AUDIO_LEVEL_FLOOR_DB;
  return Math.max(AUDIO_LEVEL_FLOOR_DB, 10 * Math.log10(meanSquare));
}
