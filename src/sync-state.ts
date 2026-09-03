// pattern: Functional Core

export type SyncPhase = 'disabled' | 'preparing' | 'active' | 'paused' | 'buffering' | 'error';

export type SyncState = Readonly<{
  readonly phase: SyncPhase;
  readonly generation: number;
  readonly mediaKey: string | null;
  readonly targetMediaSamples: number | null;
  readonly masterMediaSamples: number | null;
  readonly fallbackReason: string | null;
}>;

export type SyncEvent =
  | Readonly<{type: 'enable'; generation: number; mediaKey: string; mediaTimeSamples: number}>
  | Readonly<{type: 'ready'; generation: number}>
  | Readonly<{type: 'video-clock'; generation: number; mediaTimeSamples: number; paused: boolean; buffering: boolean; playbackRate: number}>
  | Readonly<{type: 'seek'; generation: number; mediaTimeSamples: number}>
  | Readonly<{type: 'disable'; generation: number}>
  | Readonly<{type: 'fail'; generation: number; reason: string}>;

export type SyncAction =
  | Readonly<{type: 'wait'; targetMediaSamples: number | null}>
  | Readonly<{type: 'play'; targetMediaSamples: number}>
  | Readonly<{type: 'trim'; targetMediaSamples: number}>;

export type DriftMetrics = Readonly<{
  readonly samples: ReadonlyArray<number>;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly maxMs: number | null;
}>;

export type AudioLifecyclePhase = 'preparing' | 'ready' | 'active' | 'paused' | 'buffering';

export type ResumeAudioPhaseOptions = Readonly<{
  readonly isJocConfirmed: boolean;
  readonly isNativeMuted: boolean;
}>;

const SYNC_TOLERANCE_SAMPLES = 2_400;
const MAX_DRIFT_SAMPLES = 256;

/** Creates the inactive initial state for one Bilibili media identity. */
export function createSyncState(): SyncState {
  return {
    phase: 'disabled',
    generation: 0,
    mediaKey: null,
    targetMediaSamples: null,
    masterMediaSamples: null,
    fallbackReason: null,
  };
}

/** Creates an empty bounded absolute-drift sample window. */
export function createDriftMetrics(): DriftMetrics {
  return {samples: [], p50Ms: null, p95Ms: null, maxMs: null};
}

/** Returns the lifecycle phase after the video master resumes playback. */
export function resumeAudioPhase(
  phase: AudioLifecyclePhase,
  options: ResumeAudioPhaseOptions,
): AudioLifecyclePhase {
  if (phase !== 'paused' && phase !== 'buffering') return phase;
  if (options.isNativeMuted) return 'active';
  return options.isJocConfirmed ? 'ready' : 'preparing';
}

/** Adds one drift observation and recalculates bounded p50/p95/max metrics. */
export function recordDriftSample(metrics: Readonly<DriftMetrics>, driftMs: number): DriftMetrics {
  if (!Number.isFinite(driftMs)) throw new Error('drift sample must be finite');
  const sample = Math.abs(driftMs);
  const samples = metrics.samples.length >= MAX_DRIFT_SAMPLES
    ? [...metrics.samples.slice(1), sample]
    : [...metrics.samples, sample];
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (fraction: number): number => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? sample;
  return {
    samples,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted[sorted.length - 1] ?? sample,
  };
}

/** Reduces lifecycle and video-clock events without side effects. */
export function advanceSyncState(state: Readonly<SyncState>, event: SyncEvent): SyncState {
  if (event.generation < state.generation) return state;
  switch (event.type) {
    case 'enable':
      return {
        ...state,
        phase: 'preparing',
        generation: event.generation,
        mediaKey: event.mediaKey,
        targetMediaSamples: event.mediaTimeSamples,
        masterMediaSamples: event.mediaTimeSamples,
        fallbackReason: null,
      };
    case 'ready':
      return event.generation === state.generation && state.phase === 'preparing'
        ? {...state, phase: 'active'}
        : state;
    case 'video-clock':
      if (event.generation !== state.generation) return state;
      if (event.playbackRate !== 1) {
        return {...state, phase: 'disabled', fallbackReason: 'unsupported playback rate'};
      }
      return {
        ...state,
        phase: event.buffering
          ? 'buffering'
          : event.paused
            ? 'paused'
            : state.phase === 'active' || state.phase === 'paused' || state.phase === 'buffering'
              ? 'active'
              : state.phase,
        masterMediaSamples: event.mediaTimeSamples,
        targetMediaSamples: event.mediaTimeSamples,
      };
    case 'seek':
      if (event.generation <= state.generation) return state;
      return {
        ...state,
        phase: 'preparing',
        generation: event.generation,
        targetMediaSamples: event.mediaTimeSamples,
        masterMediaSamples: event.mediaTimeSamples,
        fallbackReason: null,
      };
    case 'disable':
      return event.generation === state.generation ? {...state, phase: 'disabled', fallbackReason: null} : state;
    case 'fail':
      return event.generation === state.generation ? {...state, phase: 'error', fallbackReason: event.reason} : state;
  }
}

/** Chooses whether timestamped audio may play, wait, or trim toward video. */
export function computeSyncAction(
  state: Readonly<SyncState>,
  audioMediaSamples: number | null,
): SyncAction {
  const target = state.masterMediaSamples ?? state.targetMediaSamples;
  if (state.phase !== 'active' || target === null || audioMediaSamples === null) {
    return {type: 'wait', targetMediaSamples: target};
  }
  const drift = audioMediaSamples - target;
  if (drift < -SYNC_TOLERANCE_SAMPLES) return {type: 'wait', targetMediaSamples: target};
  if (drift > SYNC_TOLERANCE_SAMPLES) return {type: 'trim', targetMediaSamples: target};
  return {type: 'play', targetMediaSamples: target};
}
