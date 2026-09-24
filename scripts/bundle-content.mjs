// pattern: Functional Core

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

function stripModuleSyntax(source) {
  return source
    .replace(/^import[^\n]*\r?\n/gm, '')
    .replace(/^export\s+/gm, '');
}

function compiled(extensionDirectory, name) {
  return stripModuleSyntax(readFileSync(join(extensionDirectory, `${name}.js`), 'utf8'));
}

/**
 * Concatenates the compiled content-script modules into one classic script.
 * Each module keeps its own scope and receives its dependencies explicitly, so a
 * missing export fails loudly instead of leaking across module boundaries.
 */
export function createContentBundle(extensionDirectory) {
  const outputGain = compiled(extensionDirectory, 'output-gain');
  const i18n = compiled(extensionDirectory, 'joc-overlay-i18n');
  const hrtfPresets = compiled(extensionDirectory, 'hrtf-presets');
  const customSofaTransfer = compiled(extensionDirectory, 'custom-sofa-transfer');
  const state = compiled(extensionDirectory, 'joc-overlay-state');
  const startHandshake = compiled(extensionDirectory, 'start-handshake');
  const protocol = compiled(extensionDirectory, 'extension-protocol');
  const controller = compiled(extensionDirectory, 'joc-overlay-controller');
  const content = compiled(extensionDirectory, 'bilibili-content');
  return [
    `const __openjocOutputGain = (() => { ${outputGain} return {normalizeOutputGainDb, isOutputGainDb, OUTPUT_GAIN_MIN_DB, OUTPUT_GAIN_MAX_DB, OUTPUT_GAIN_STEP_DB}; })();`,
    `const __openjocOverlayI18n = (() => { ${i18n} return {DEFAULT_OVERLAY_LANGUAGE, OVERLAY_LANGUAGE_OPTIONS, isOverlayLanguage, normalizeOverlayLanguage, overlayLanguageLabel, overlayMessage}; })();`,
    `const __openjocHrtfPresets = (() => { ${hrtfPresets} return {DEFAULT_HRTF_PRESET, HRTF_IMPORT_OPTION, HRTF_PRESET_OPTIONS, HRTF_SELECTION_OPTIONS, isHrtfPreset, isHrtfSelection, normalizeHrtfPreset, normalizeHrtfSelection, hrtfPresetLabel, hrtfSelectionLabel}; })();`,
    `const __openjocCustomSofaTransfer = (() => { ${customSofaTransfer} return {CUSTOM_SOFA_CHUNK_BYTES, MAX_CUSTOM_SOFA_BYTES, customSofaChunkCount, expectedCustomSofaChunkLength, isValidCustomSofaBase64}; })();`,
    `const __openjocOverlayState = (() => { const {normalizeOutputGainDb} = __openjocOutputGain; const {DEFAULT_OVERLAY_LANGUAGE, normalizeOverlayLanguage} = __openjocOverlayI18n; const {DEFAULT_HRTF_PRESET} = __openjocHrtfPresets; ${state} return {advanceOverlayState, createOverlayState, needsOverlayMarkupRebuild, overlayRendererLabel, resetOverlayState, OVERLAY_RENDERER_OPTIONS}; })();`,
    `const __openjocStartHandshake = (() => { ${startHandshake} return {acknowledgeStart, createStartHandshake, nextStartHandshakeAction, recordStartAttempt, shouldAcceptPlaybackStatus, shouldDispatchSessionRecovery, shouldExpirePlaybackStatus, shouldRestartAfterSeek}; })();`,
    `const __openjocExtensionProtocol = (() => { const {isOutputGainDb} = __openjocOutputGain; const {isHrtfSelection} = __openjocHrtfPresets; const {isValidCustomSofaBase64, MAX_CUSTOM_SOFA_BYTES} = __openjocCustomSofaTransfer; ${protocol} return {isRuntimeMessage}; })();`,
    `const __openjocOverlayController = (() => { const {normalizeOutputGainDb, OUTPUT_GAIN_MIN_DB, OUTPUT_GAIN_MAX_DB, OUTPUT_GAIN_STEP_DB} = __openjocOutputGain; const {OVERLAY_LANGUAGE_OPTIONS, isOverlayLanguage, normalizeOverlayLanguage, overlayMessage} = __openjocOverlayI18n; const {HRTF_IMPORT_OPTION, HRTF_SELECTION_OPTIONS, hrtfSelectionLabel, normalizeHrtfSelection} = __openjocHrtfPresets; const {advanceOverlayState, createOverlayState, needsOverlayMarkupRebuild, overlayRendererLabel, resetOverlayState, OVERLAY_RENDERER_OPTIONS} = __openjocOverlayState; ${controller} return {createJocOverlayController}; })();`,
    `(() => { const {normalizeOutputGainDb} = __openjocOutputGain; const {normalizeOverlayLanguage} = __openjocOverlayI18n; const {DEFAULT_HRTF_PRESET, normalizeHrtfSelection} = __openjocHrtfPresets; const {CUSTOM_SOFA_CHUNK_BYTES, customSofaChunkCount, MAX_CUSTOM_SOFA_BYTES} = __openjocCustomSofaTransfer; const {isRuntimeMessage} = __openjocExtensionProtocol; const {createJocOverlayController} = __openjocOverlayController; const {acknowledgeStart, createStartHandshake, nextStartHandshakeAction, recordStartAttempt, shouldAcceptPlaybackStatus, shouldDispatchSessionRecovery, shouldExpirePlaybackStatus, shouldRestartAfterSeek} = __openjocStartHandshake; ${content} })();`,
  ].join('\n\n');
}
