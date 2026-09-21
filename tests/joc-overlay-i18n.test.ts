// pattern: Functional Core

import {DEFAULT_OVERLAY_LANGUAGE, OVERLAY_LANGUAGE_OPTIONS, isOverlayLanguage, normalizeOverlayLanguage, overlayLanguageLabel, overlayMessage, type OverlayLanguage, type OverlayMessageKey} from '../src/joc-overlay-i18n.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Every interface string the controller renders, so a missing translation fails here. */
const RENDERED_KEYS: ReadonlyArray<OverlayMessageKey> = [
  'panelAriaLabel', 'detectedTitle', 'detectedBody', 'dismissDetection', 'enable', 'enableOpenJoc',
  'expandPanel', 'collapsePanel', 'closeErrorPanel', 'closeNotice', 'statusEnabledDiagnostics',
  'statusPreparing', 'statusReady', 'statusPaused', 'statusBuffering', 'statusActive', 'statusEnabled',
  'currentAudio', 'outputMode', 'rendererStereo', 'rendererBinaural', 'dialnormField', 'dialnormCalibrated',
  'dialnormUnity', 'dialnormCalibratedHelp', 'dialnormUnityHelp', 'healthAriaLabel', 'healthSync',
  'healthLoudness', 'waitingForData', 'advancedEntry', 'advancedEntryHint', 'disableOpenJoc',
  'advancedDiagnostics', 'liveSnapshot', 'languageField', 'languageHelp', 'customGain', 'customGainValueAria',
  'customGainHelp', 'reset', 'diagGroupDecoder', 'diagGroupInput', 'diagGroupProfile', 'diagGroupAudio',
  'diagGroupRealtime', 'diagGroupMemory', 'diagGroupBinaural', 'diagDecoder', 'diagInput', 'diagStatus',
  'diagProfile', 'diagStage', 'diagSampleRate', 'diagOutputChannels', 'diagRenderer', 'diagDrift',
  'diagLoudness', 'diagBuffer', 'diagUnderruns', 'diagDecodeP95', 'diagRealtimeFactor', 'diagWasmCurrent',
  'diagWasmPeak', 'diagVirtualLayout', 'diagHrtf', 'diagBinauralLatency', 'diagBinauralP95',
  'waitingForProfile', 'alwaysEnableOpenJoc', 'rawDiagnosticsJson', 'copyJson', 'collapseDiagnostics',
  'copied', 'copyFailed', 'errorStatus', 'errorEyebrow', 'errorTitle', 'errorReasonLabel', 'errorCodeLabel',
  'errorDefaultReason', 'errorHint', 'returnNativeAudio', 'details', 'errorUnderlyingReason',
  'errorFailedStage', 'errorNativeDecoder', 'errorNativeDecoderUnused', 'errorUnknownStage',
  'errorRateUnsupported', 'errorProfileInvalid', 'errorMediaUnavailable', 'errorDecodeFailed',
  'nonJocTitle', 'nonJocBody', 'nonJocStatus', 'defaultVirtualLayout',
];

const LANGUAGES: ReadonlyArray<OverlayLanguage> = ['zh-CN', 'en'];

/** Keys whose value is intentionally identical in both languages. */
const LANGUAGE_NEUTRAL_KEYS: ReadonlyArray<OverlayMessageKey> = ['errorUnknownStage', 'diagHrtf'];

function run(): void {
  assert(DEFAULT_OVERLAY_LANGUAGE === 'zh-CN', 'Chinese remains the default interface language');
  assert(OVERLAY_LANGUAGE_OPTIONS.length === 2, 'the advanced panel offers exactly two languages');
  assert(OVERLAY_LANGUAGE_OPTIONS.some((option) => option.language === 'zh-CN'), 'the Chinese option is offered');
  assert(OVERLAY_LANGUAGE_OPTIONS.some((option) => option.language === 'en'), 'the English option is offered');
  assert(overlayLanguageLabel('en') === 'English', 'the language label is written in its own language');

  assert(isOverlayLanguage('en') && isOverlayLanguage('zh-CN'), 'both catalogued languages are recognised');
  assert(!isOverlayLanguage('de') && !isOverlayLanguage(undefined), 'unknown values are not recognised as a language');
  assert(normalizeOverlayLanguage('en') === 'en', 'a stored English preference is accepted');
  assert(normalizeOverlayLanguage('zh-CN') === 'zh-CN', 'a stored Chinese preference is accepted');
  assert(normalizeOverlayLanguage('fr') === 'zh-CN', 'an unsupported language falls back to the default');
  assert(normalizeOverlayLanguage(undefined) === 'zh-CN', 'a missing preference falls back to the default');
  assert(normalizeOverlayLanguage(7) === 'zh-CN', 'a non-string preference falls back to the default');
  assert(normalizeOverlayLanguage(null) === 'zh-CN', 'a null preference falls back to the default');

  for (const language of LANGUAGES) {
    for (const key of RENDERED_KEYS) {
      const value = overlayMessage(language, key);
      assert(typeof value === 'string' && value.length > 0, `${language} provides a non-empty string for ${key}`);
    }
  }

  for (const key of RENDERED_KEYS) {
    if (LANGUAGE_NEUTRAL_KEYS.includes(key)) {
      assert(overlayMessage('en', key) === overlayMessage('zh-CN', key), `${key} stays language-neutral`);
      continue;
    }
    assert(overlayMessage('en', key) !== overlayMessage('zh-CN', key), `${key} is translated for English`);
  }

  const english = RENDERED_KEYS.map((key) => overlayMessage('en', key));
  for (const value of english) {
    assert(!/[\u4e00-\u9fff]/u.test(value), `the English catalogue exposes no Chinese text: ${value}`);
  }

  assert(overlayMessage('en', 'alwaysEnableOpenJoc') === 'Always enable OpenJOC', 'the advanced toggle has an English label');
  assert(overlayMessage('zh-CN', 'alwaysEnableOpenJoc') === '始终启用 OpenJOC', 'the advanced toggle keeps its Chinese label');
  assert(overlayMessage('zh-CN', 'languageField') === '语言 / Language', 'the default language selector identifies itself bilingually');
  assert(overlayMessage('en', 'languageField') === 'Language', 'the language selector has an English label');
  assert(overlayMessage('en', 'customGain') === 'Custom gain', 'the gain setting is translated');
  assert(overlayMessage('en', 'liveSnapshot') === 'Live snapshot', 'the diagnostics heading value is translated');
}

run();
