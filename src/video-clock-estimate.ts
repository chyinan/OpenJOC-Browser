// pattern: Functional Core

export const VIDEO_CLOCK_SAMPLE_RATE = 48_000;

/** Estimates media time only for background prefetch scheduling. */
export function estimateMediaTimeSamples(lastMediaTimeSamples: number, elapsedMs: number, playbackRate: number): number {
  const safeLast = Number.isFinite(lastMediaTimeSamples) ? Math.max(0, lastMediaTimeSamples) : 0;
  const safeElapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const safeRate = Number.isFinite(playbackRate) ? Math.max(0, playbackRate) : 0;
  return Math.max(safeLast, Math.round(safeLast + safeElapsed * safeRate * VIDEO_CLOCK_SAMPLE_RATE / 1_000));
}
