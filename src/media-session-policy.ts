// pattern: Functional Core

export type MediaSessionSnapshot = Readonly<{
  readonly mediaKey: string;
  readonly candidateUrl: string;
  readonly generation: number;
  readonly started: boolean;
}>;

export type MediaSessionTarget = Readonly<{
  readonly mediaKey: string;
  readonly generation: number;
}>;

/** A media identity change must never reuse the previous decoder timeline. */
export function mediaSessionRestartRequired(
  previous: MediaSessionSnapshot | null,
  next: MediaSessionSnapshot,
): boolean {
  return previous === null
    || previous.mediaKey !== next.mediaKey
    || previous.candidateUrl !== next.candidateUrl;
}

/** Advances the generation only for a running session whose media changed. */
export function nextManifestGeneration(
  previous: MediaSessionSnapshot | null,
  next: MediaSessionSnapshot,
): number {
  if (previous === null) return 0;
  return previous.started && mediaSessionRestartRequired(previous, next)
    ? previous.generation + 1
    : previous.generation;
}

/** Rejects delayed content messages from an older running media generation. */
export function isStaleContentGeneration(
  previous: MediaSessionSnapshot | null,
  messageGeneration: number,
): boolean {
  return previous !== null && messageGeneration < previous.generation;
}

export function isContentSessionReset(
  previous: MediaSessionSnapshot | null,
  nextMediaKey: string,
  nextGeneration: number,
): boolean {
  return previous !== null
    && previous.mediaKey === nextMediaKey
    && nextGeneration < previous.generation;
}

export function sessionTargetMatches(
  current: MediaSessionSnapshot | MediaSessionTarget | null,
  target: MediaSessionTarget,
): boolean {
  return current !== null
    && current.mediaKey === target.mediaKey
    && current.generation === target.generation;
}

/** Tab update events are not ordered against content messages and cannot safely reset playback. */
export function shouldResetTabSession(status: string | undefined): boolean {
  void status;
  return false;
}
