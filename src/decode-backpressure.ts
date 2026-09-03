// pattern: Functional Core

/** Returns whether CMAF decoding must wait for the bounded PCM queue. */
export function shouldWaitForCmafAudioBudget(queuedAudioMs: number, maxQueuedAudioMs: number): boolean {
  if (!Number.isFinite(queuedAudioMs) || queuedAudioMs < 0) throw new Error('queued CMAF audio duration is invalid');
  if (!Number.isFinite(maxQueuedAudioMs) || maxQueuedAudioMs <= 0) throw new Error('maximum CMAF audio duration is invalid');
  return queuedAudioMs > maxQueuedAudioMs;
}
