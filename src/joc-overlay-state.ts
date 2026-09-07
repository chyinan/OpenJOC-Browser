// pattern: Functional Core

import {normalizeOutputGainDb} from './output-gain.js';

export type OverlayMode = 'hidden' | 'detected' | 'active' | 'collapsed' | 'diagnostics' | 'raw' | 'error' | 'nonjoc';

export type OverlayRenderer = 'stereo-speakers' | 'binaural-headphones';

export type DialnormMode = 'calibrated' | 'unity';

export type OverlayRendererOption = Readonly<{
  readonly renderer: OverlayRenderer;
  readonly label: string;
  readonly enabled: boolean;
}>;

export const OVERLAY_RENDERER_OPTIONS: ReadonlyArray<OverlayRendererOption> = [
  {renderer: 'stereo-speakers', label: 'Stereo (Speakers)', enabled: true},
  {renderer: 'binaural-headphones', label: 'Binaural (Headphones)', enabled: true},
];

export type OverlayState = Readonly<{
  readonly mode: OverlayMode;
  readonly renderer: OverlayRenderer;
  readonly dialnorm: DialnormMode;
  readonly gainDb: number;
  readonly alwaysEnabled: boolean;
  readonly errorDetailsOpen: boolean;
  readonly hasJoc: boolean;
  readonly detectionDismissed: boolean;
}>;

export type OverlayEvent =
  | Readonly<{readonly type: 'manifest'; readonly hasJoc: boolean}>
  | Readonly<{readonly type: 'manual-open'}>
  | Readonly<{readonly type: 'enable'}>
  | Readonly<{readonly type: 'disable'}>
  | Readonly<{readonly type: 'collapse'}>
  | Readonly<{readonly type: 'expand'}>
  | Readonly<{readonly type: 'open-diagnostics'}>
  | Readonly<{readonly type: 'close-diagnostics'}>
  | Readonly<{readonly type: 'open-raw'}>
  | Readonly<{readonly type: 'toggle-error-details'}>
  | Readonly<{readonly type: 'error'}>
  | Readonly<{readonly type: 'close-error'}>
  | Readonly<{readonly type: 'return-native'}>
  | Readonly<{readonly type: 'dismiss-detection'}>
  | Readonly<{readonly type: 'close-nonjoc'}>
  | Readonly<{readonly type: 'set-renderer'; readonly renderer: OverlayRenderer}>
  | Readonly<{readonly type: 'set-dialnorm'; readonly mode: DialnormMode}>
  | Readonly<{readonly type: 'set-gain'; readonly gainDb: number}>
  | Readonly<{readonly type: 'set-always-enabled'; readonly enabled: boolean}>;

export type OverlayPlaybackPhase = 'disabled' | 'preparing' | 'ready' | 'active' | 'paused' | 'buffering' | 'error';

export function createOverlayState(): OverlayState {
  return {
    mode: 'hidden',
    renderer: 'stereo-speakers',
    dialnorm: 'calibrated',
    gainDb: 0,
    alwaysEnabled: false,
    errorDetailsOpen: false,
    hasJoc: false,
    detectionDismissed: false,
  };
}

/** Resets page/display lifecycle while preserving user-selected audio policy. */
export function resetOverlayState(state: Readonly<OverlayState>): OverlayState {
  return {...createOverlayState(), renderer: state.renderer, dialnorm: state.dialnorm, gainDb: state.gainDb, alwaysEnabled: state.alwaysEnabled};
}

export function overlayRendererLabel(renderer: OverlayRenderer): string {
  return OVERLAY_RENDERER_OPTIONS.find((option) => option.renderer === renderer)?.label ?? 'Stereo (Speakers)';
}

/** Keeps live status ticks from replacing focused controls or open native menus. */
export function needsOverlayMarkupRebuild(mode: OverlayMode, phase: OverlayPlaybackPhase): boolean {
  return phase === 'error' && mode !== 'error';
}

export function advanceOverlayState(state: Readonly<OverlayState>, event: OverlayEvent): OverlayState {
  switch (event.type) {
    case 'manifest':
      if (!event.hasJoc) {
        return {...state, mode: 'hidden', hasJoc: false, detectionDismissed: false, errorDetailsOpen: false};
      }
      return state.hasJoc || state.detectionDismissed || state.mode !== 'hidden'
        ? {...state, hasJoc: true}
        : {...state, mode: 'detected', hasJoc: true};
    case 'manual-open':
      return state.hasJoc
        ? {...state, mode: state.mode === 'active' || state.mode === 'collapsed' || state.mode === 'diagnostics' || state.mode === 'raw' ? state.mode : 'detected', detectionDismissed: false, errorDetailsOpen: false}
        : {...state, mode: 'nonjoc', errorDetailsOpen: false};
    case 'enable':
      return state.hasJoc ? {...state, mode: 'active', detectionDismissed: false, errorDetailsOpen: false} : state;
    case 'disable':
      return {...state, mode: state.hasJoc ? 'detected' : 'hidden', detectionDismissed: false, errorDetailsOpen: false};
    case 'collapse':
      return state.mode === 'active' || state.mode === 'diagnostics' || state.mode === 'raw'
        ? {...state, mode: 'collapsed', errorDetailsOpen: false}
        : state;
    case 'expand':
      return state.mode === 'collapsed' ? {...state, mode: 'active'} : state;
    case 'open-diagnostics':
      return state.mode === 'active' ? {...state, mode: 'diagnostics', errorDetailsOpen: false} : state;
    case 'close-diagnostics':
      return state.mode === 'diagnostics' || state.mode === 'raw' ? {...state, mode: 'active'} : state;
    case 'open-raw':
      return state.mode === 'diagnostics' ? {...state, mode: 'raw'} : state;
    case 'toggle-error-details':
      return state.mode === 'error' ? {...state, errorDetailsOpen: !state.errorDetailsOpen} : state;
    case 'error':
      return {...state, mode: 'error', errorDetailsOpen: false};
    case 'close-error':
      return {...state, mode: state.hasJoc ? 'detected' : 'hidden', errorDetailsOpen: false};
    case 'return-native':
      return {...state, mode: 'hidden', detectionDismissed: true, errorDetailsOpen: false};
    case 'dismiss-detection':
      return {...state, mode: 'hidden', detectionDismissed: true, errorDetailsOpen: false};
    case 'close-nonjoc':
      return state.mode === 'nonjoc' ? {...state, mode: 'hidden'} : state;
    case 'set-renderer':
      return isAvailableRenderer(event.renderer) ? {...state, renderer: event.renderer} : state;
    case 'set-dialnorm':
      return {...state, dialnorm: event.mode};
    case 'set-gain':
      return {...state, gainDb: normalizeOutputGainDb(event.gainDb)};
    case 'set-always-enabled':
      return {...state, alwaysEnabled: event.enabled};
  }
}

function isAvailableRenderer(renderer: OverlayRenderer): boolean {
  return OVERLAY_RENDERER_OPTIONS.some((option) => option.renderer === renderer && option.enabled);
}
