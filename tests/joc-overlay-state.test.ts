// pattern: Functional Core

import {advanceOverlayState, createOverlayState, needsOverlayMarkupRebuild, overlayRendererLabel, resetOverlayState, type OverlayEvent} from '../src/joc-overlay-state.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function apply(state: ReturnType<typeof createOverlayState>, event: OverlayEvent): ReturnType<typeof createOverlayState> {
  return advanceOverlayState(state, event);
}

function run(): void {
  let state = createOverlayState();
  assert(state.mode === 'hidden', 'the controller is hidden before detection');

  state = apply(state, {type: 'manifest', hasJoc: true});
  assert(state.mode === 'detected', 'a JOC manifest opens the detection notice');
  state = apply(state, {type: 'enable'});
  assert(state.mode === 'active', 'enable enters the active control panel');
  state = apply(state, {type: 'collapse'});
  assert(state.mode === 'collapsed', 'collapse leaves the minimum status capsule');
  state = apply(state, {type: 'expand'});
  assert(state.mode === 'active', 'expand returns to the active panel');
  state = apply(state, {type: 'open-diagnostics'});
  assert(state.mode === 'diagnostics', 'advanced diagnostics are a separate layer');
  state = apply(state, {type: 'open-raw'});
  assert(state.mode === 'raw', 'raw JSON is nested below advanced diagnostics');
  state = apply(state, {type: 'close-diagnostics'});
  assert(state.mode === 'active', 'closing diagnostics returns to the normal panel');

  state = apply(state, {type: 'error'});
  assert(state.mode === 'error' && !state.errorDetailsOpen, 'errors close technical details by default');
  state = apply(state, {type: 'toggle-error-details'});
  assert(state.errorDetailsOpen, 'error details can be expanded');
  state = apply(state, {type: 'return-native'});
  assert(state.mode === 'hidden', 'returning to native audio hides the controller');

  state = apply(state, {type: 'manifest', hasJoc: true});
  assert(state.mode === 'hidden', 'dismissed detection does not reappear for the same page');
  state = apply(state, {type: 'manual-open'});
  assert(state.mode === 'detected', 'manual open can revisit the JOC detection notice');
  state = apply(state, {type: 'disable'});
  assert(state.mode === 'detected', 'disabling OpenJOC returns to the JOC detection notice');

  state = apply(createOverlayState(), {type: 'manual-open'});
  assert(state.mode === 'nonjoc', 'manual open on a non-JOC page shows only the minimal notice');
  state = apply(state, {type: 'close-nonjoc'});
  assert(state.mode === 'hidden', 'closing the non-JOC notice hides the controller');

  state = apply(createOverlayState(), {type: 'set-renderer', renderer: 'binaural-headphones'});
  assert(state.renderer === 'binaural-headphones', 'available Binaural renderer can be explicitly selected');
  state = apply(state, {type: 'set-dialnorm', mode: 'unity'});
  assert(state.dialnorm === 'unity', 'dialnorm selection is retained in controller state');
  state = apply(state, {type: 'set-always-enabled', enabled: true});
  assert(state.alwaysEnabled, 'always-enable preference can be enabled');
  const reset = resetOverlayState(state);
  assert(reset.mode === 'hidden', 'reset clears the display lifecycle');
  assert(reset.renderer === 'binaural-headphones', 'reset preserves the selected renderer');
  assert(reset.dialnorm === 'unity', 'reset preserves the selected Dialnorm mode');
  assert(reset.alwaysEnabled, 'reset preserves the always-enable preference');
  assert(overlayRendererLabel(reset.renderer) === 'Binaural (Headphones)', 'renderer label describes the active renderer');

  assert(!needsOverlayMarkupRebuild('active', 'active'), 'repeated active status updates preserve interactive DOM');
  assert(!needsOverlayMarkupRebuild('active', 'buffering'), 'buffering status updates preserve interactive DOM');
  assert(needsOverlayMarkupRebuild('active', 'error'), 'entering the error state changes the overlay structure');
  assert(!needsOverlayMarkupRebuild('error', 'error'), 'repeated error updates preserve error controls');
}

run();
