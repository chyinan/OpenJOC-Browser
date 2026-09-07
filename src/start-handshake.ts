// pattern: Functional Core

export type StartHandshakeState = Readonly<{
  readonly attempts: number;
  readonly firstAttemptAtMs: number | null;
  readonly lastAttemptAtMs: number | null;
  readonly acknowledged: boolean;
}>;

export type StartHandshakeAction = 'wait' | 'give-up';

export function createStartHandshake(): StartHandshakeState {
  return {attempts: 0, firstAttemptAtMs: null, lastAttemptAtMs: null, acknowledged: false};
}

export function recordStartAttempt(state: StartHandshakeState, nowMs: number): StartHandshakeState {
  return {attempts: state.attempts + 1, firstAttemptAtMs: state.firstAttemptAtMs ?? nowMs, lastAttemptAtMs: nowMs, acknowledged: false};
}

export function acknowledgeStart(state: StartHandshakeState): StartHandshakeState {
  return {...state, acknowledged: true};
}

export function shouldDispatchSessionRecovery(
  isForced: boolean,
  state: StartHandshakeState,
): boolean {
  return isForced || state.attempts === 0 || state.acknowledged;
}

export function nextStartHandshakeAction(
  state: StartHandshakeState,
  nowMs: number,
  acknowledgementTimeoutMs: number,
): StartHandshakeAction {
  if (state.acknowledged || state.firstAttemptAtMs === null || nowMs - state.firstAttemptAtMs < acknowledgementTimeoutMs) return 'wait';
  return 'give-up';
}

export function shouldRestartAfterSeek(isOpenJocRequested: boolean, hasPendingSeek: boolean): boolean {
  return isOpenJocRequested && hasPendingSeek;
}

export function shouldAcceptPlaybackStatus(
  activeRequestId: string | null,
  activeMediaKey: string | null,
  statusRequestId: string,
  statusMediaKey: string,
): boolean {
  return activeRequestId !== null
    && activeMediaKey !== null
    && activeRequestId === statusRequestId
    && activeMediaKey === statusMediaKey;
}

export function shouldExpirePlaybackStatus(input: Readonly<{
  readonly requested: boolean;
  readonly hasStatus: boolean;
  readonly isStreaming: boolean;
  readonly documentVisible: boolean;
  readonly videoPaused: boolean;
  readonly videoSeeking: boolean;
  readonly elapsedMs: number;
  readonly timeoutMs: number;
}>): boolean {
  return input.requested
    && input.hasStatus
    && !input.isStreaming
    && input.documentVisible
    && !input.videoPaused
    && !input.videoSeeking
    && input.elapsedMs >= input.timeoutMs;
}
