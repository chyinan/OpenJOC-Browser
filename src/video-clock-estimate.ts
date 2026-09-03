// pattern: Functional Core

export const VIDEO_CLOCK_SAMPLE_RATE = 48_000;

/** Estimates media time only for background prefetch scheduling. */
export function estimateMediaTimeSamples(lastMediaTimeSamples: number, elapsedMs: number, playbackRate: number): number {
  const safeLast = Number.isFinite(lastMediaTimeSamples) ? Math.max(0, lastMediaTimeSamples) : 0;
  const safeElapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const safeRate = Number.isFinite(playbackRate) ? Math.max(0, playbackRate) : 0;
  return Math.max(safeLast, Math.round(safeLast + safeElapsed * safeRate * VIDEO_CLOCK_SAMPLE_RATE / 1_000));
}

/** Advances a running media clock by one rendered output quantum. */
export function advanceMediaTimeSamples(currentMediaSamples: number | null, renderedFrameCount: number, isRunning: boolean): number | null {
  if (currentMediaSamples === null || !isRunning) return currentMediaSamples;
  if (!Number.isSafeInteger(renderedFrameCount) || renderedFrameCount < 0) throw new Error('rendered frame count is invalid');
  return currentMediaSamples + renderedFrameCount;
}
