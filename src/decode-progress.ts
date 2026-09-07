// pattern: Functional Core

export type DecoderProgressWatchdog = Readonly<{
  readonly remainingMs: number;
  readonly observedAtMs: number;
  readonly isPaused: boolean;
}>;

export type CreateDecoderProgressWatchdogOptions = Readonly<{
  readonly timeoutMs: number;
  readonly nowMs: number;
  readonly isPaused?: boolean;
}>;

export type AdvanceDecoderProgressWatchdogOptions = Readonly<{
  readonly watchdog: DecoderProgressWatchdog;
  readonly nowMs: number;
  readonly isPaused: boolean;
}>;

export type DecoderProgressWatchdogUpdate = Readonly<{
  readonly state: DecoderProgressWatchdog;
  readonly expired: boolean;
}>;

export function createDecoderProgressWatchdog(options: CreateDecoderProgressWatchdogOptions): DecoderProgressWatchdog {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('decoder progress timeout is invalid');
  }
  if (!Number.isFinite(options.nowMs) || options.nowMs < 0) {
    throw new Error('decoder progress clock is invalid');
  }
  return {remainingMs: options.timeoutMs, observedAtMs: options.nowMs, isPaused: options.isPaused ?? false};
}

export function advanceDecoderProgressWatchdog(options: AdvanceDecoderProgressWatchdogOptions): DecoderProgressWatchdogUpdate {
  const {watchdog, nowMs, isPaused} = options;
  if (!Number.isFinite(watchdog.remainingMs) || watchdog.remainingMs < 0) {
    throw new Error('decoder progress watchdog state is invalid');
  }
  if (!Number.isFinite(watchdog.observedAtMs) || watchdog.observedAtMs < 0 || !Number.isFinite(nowMs) || nowMs < watchdog.observedAtMs) {
    throw new Error('decoder progress clock moved backwards');
  }
  const elapsedMs = nowMs - watchdog.observedAtMs;
  const remainingMs = isPaused || watchdog.isPaused ? watchdog.remainingMs : Math.max(0, watchdog.remainingMs - elapsedMs);
  return {state: {remainingMs, observedAtMs: nowMs, isPaused}, expired: !isPaused && remainingMs === 0};
}

export function hasDecoderMadeProgress(previousAccessUnits: number, currentAccessUnits: number): boolean {
  return currentAccessUnits > previousAccessUnits;
}
