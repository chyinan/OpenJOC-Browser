// pattern: Functional Core

export type OverlayLanguage = 'zh-CN' | 'en';

export type OverlayLanguageOption = Readonly<{
  readonly language: OverlayLanguage;
  readonly label: string;
}>;

export const DEFAULT_OVERLAY_LANGUAGE: OverlayLanguage = 'zh-CN';

/** Each option is written in its own language so the choice stays readable in either locale. */
export const OVERLAY_LANGUAGE_OPTIONS: ReadonlyArray<OverlayLanguageOption> = [
  {language: 'zh-CN', label: '简体中文'},
  {language: 'en', label: 'English'},
];

export function isOverlayLanguage(value: unknown): value is OverlayLanguage {
  return OVERLAY_LANGUAGE_OPTIONS.some((option) => option.language === value);
}

export function normalizeOverlayLanguage(value: unknown): OverlayLanguage {
  return isOverlayLanguage(value) ? value : DEFAULT_OVERLAY_LANGUAGE;
}

export function overlayLanguageLabel(language: OverlayLanguage): string {
  return OVERLAY_LANGUAGE_OPTIONS.find((option) => option.language === language)?.label ?? language;
}

export type OverlayMessageKey =
  | 'panelAriaLabel'
  | 'detectedTitle'
  | 'detectedBody'
  | 'dismissDetection'
  | 'enable'
  | 'enableOpenJoc'
  | 'expandPanel'
  | 'collapsePanel'
  | 'closeErrorPanel'
  | 'closeNotice'
  | 'statusEnabledDiagnostics'
  | 'statusPreparing'
  | 'statusReady'
  | 'statusPaused'
  | 'statusBuffering'
  | 'statusActive'
  | 'statusEnabled'
  | 'currentAudio'
  | 'outputMode'
  | 'rendererStereo'
  | 'rendererBinaural'
  | 'dialnormField'
  | 'dialnormCalibrated'
  | 'dialnormUnity'
  | 'dialnormCalibratedHelp'
  | 'dialnormUnityHelp'
  | 'healthAriaLabel'
  | 'healthSync'
  | 'healthLoudness'
  | 'waitingForData'
  | 'advancedEntry'
  | 'advancedEntryHint'
  | 'disableOpenJoc'
  | 'advancedDiagnostics'
  | 'liveSnapshot'
  | 'languageField'
  | 'languageHelp'
  | 'customGain'
  | 'customGainValueAria'
  | 'customGainHelp'
  | 'reset'
  | 'diagGroupDecoder'
  | 'diagGroupInput'
  | 'diagGroupProfile'
  | 'diagGroupAudio'
  | 'diagGroupRealtime'
  | 'diagGroupMemory'
  | 'diagGroupBinaural'
  | 'diagDecoder'
  | 'diagInput'
  | 'diagStatus'
  | 'diagProfile'
  | 'diagStage'
  | 'diagSampleRate'
  | 'diagOutputChannels'
  | 'diagRenderer'
  | 'diagDrift'
  | 'diagLoudness'
  | 'diagBuffer'
  | 'diagUnderruns'
  | 'diagDecodeP95'
  | 'diagRealtimeFactor'
  | 'diagWasmCurrent'
  | 'diagWasmPeak'
  | 'diagVirtualLayout'
  | 'diagHrtf'
  | 'diagBinauralLatency'
  | 'diagBinauralP95'
  | 'waitingForProfile'
  | 'alwaysEnableOpenJoc'
  | 'rawDiagnosticsJson'
  | 'copyJson'
  | 'collapseDiagnostics'
  | 'copied'
  | 'copyFailed'
  | 'errorStatus'
  | 'errorEyebrow'
  | 'errorTitle'
  | 'errorReasonLabel'
  | 'errorCodeLabel'
  | 'errorDefaultReason'
  | 'errorHint'
  | 'returnNativeAudio'
  | 'details'
  | 'errorUnderlyingReason'
  | 'errorFailedStage'
  | 'errorNativeDecoder'
  | 'errorNativeDecoderUnused'
  | 'errorUnknownStage'
  | 'errorRateUnsupported'
  | 'errorProfileInvalid'
  | 'errorMediaUnavailable'
  | 'errorDecodeFailed'
  | 'nonJocTitle'
  | 'nonJocBody'
  | 'nonJocStatus'
  | 'defaultVirtualLayout';

type OverlayMessages = Readonly<Record<OverlayMessageKey, string>>;

const ZH_CN_MESSAGES: OverlayMessages = {
  panelAriaLabel: 'OpenJOC 音频控制器',
  detectedTitle: 'JOC 音频已检测',
  detectedBody: '当前视频包含 E-AC-3 JOC 流。',
  dismissDetection: '关闭检测提示',
  enable: '启用',
  enableOpenJoc: '启用 OpenJOC',
  expandPanel: '展开 OpenJOC 控制器',
  collapsePanel: '折叠 OpenJOC 控制器',
  closeErrorPanel: '关闭错误面板',
  closeNotice: '关闭提示',
  statusEnabledDiagnostics: '已启用 · 高级信息',
  statusPreparing: '准备中',
  statusReady: '已启用 · 等待音频',
  statusPaused: '已启用 · 已暂停',
  statusBuffering: '已启用 · 缓冲中',
  statusActive: '已启用',
  statusEnabled: '已启用',
  currentAudio: '当前音频',
  outputMode: '输出方式',
  rendererStereo: '立体声（扬声器）',
  rendererBinaural: '双耳（耳机）',
  dialnormField: '节目电平',
  dialnormCalibrated: '校准（推荐）',
  dialnormUnity: 'Unity / 兼容模式',
  dialnormCalibratedHelp: '遵循节目 Dialnorm 元数据。',
  dialnormUnityHelp: '关闭 Dialnorm 衰减，优先保证兼容性。',
  healthAriaLabel: '播放健康',
  healthSync: '音画同步',
  healthLoudness: '平均响度',
  waitingForData: '等待数据',
  advancedEntry: '高级',
  advancedEntryHint: '技术信息',
  disableOpenJoc: '停用 OpenJOC',
  advancedDiagnostics: '高级诊断',
  liveSnapshot: '实时快照',
  languageField: '语言',
  languageHelp: '切换控制器界面语言，并记住该选择。',
  customGain: '自定义增益',
  customGainValueAria: '自定义增益数值',
  customGainHelp: '0 dB 保持原音量，提升过高可能失真。',
  reset: '重置',
  diagGroupDecoder: '解码器',
  diagGroupInput: '输入',
  diagGroupProfile: '配置',
  diagGroupAudio: '音频',
  diagGroupRealtime: '实时',
  diagGroupMemory: '内存',
  diagGroupBinaural: '双耳渲染',
  diagDecoder: '解码器',
  diagInput: '输入',
  diagStatus: '状态',
  diagProfile: '配置',
  diagStage: '阶段',
  diagSampleRate: '采样率',
  diagOutputChannels: '输出声道',
  diagRenderer: '渲染器',
  diagDrift: '音画偏移',
  diagLoudness: '平均响度',
  diagBuffer: '缓冲',
  diagUnderruns: '欠载',
  diagDecodeP95: '解码 p95',
  diagRealtimeFactor: '实时因子',
  diagWasmCurrent: 'WASM 当前',
  diagWasmPeak: 'WASM 峰值',
  diagVirtualLayout: '虚拟布局',
  diagHrtf: 'HRTF',
  diagBinauralLatency: '双耳延迟',
  diagBinauralP95: '双耳 p95',
  waitingForProfile: '等待 JOC 配置',
  alwaysEnableOpenJoc: '始终启用 OpenJOC',
  rawDiagnosticsJson: '原始诊断 JSON',
  copyJson: '复制 JSON',
  collapseDiagnostics: '收起高级诊断',
  copied: '已复制',
  copyFailed: '复制失败，请手动选择',
  errorStatus: '播放失败',
  errorEyebrow: '无法继续播放',
  errorTitle: '无法解码 JOC 音频',
  errorReasonLabel: '原因',
  errorCodeLabel: '错误代码',
  errorDefaultReason: 'OpenJOC 未返回更具体的失败原因。',
  errorHint: '请尝试刷新页面后再试。',
  returnNativeAudio: '返回原生音频',
  details: '详情',
  errorUnderlyingReason: '底层原因',
  errorFailedStage: '失败阶段',
  errorNativeDecoder: '原生 Dolby 解码器',
  errorNativeDecoderUnused: '未使用',
  errorUnknownStage: 'unknown',
  errorRateUnsupported: '当前播放速度不是 1.0x，OpenJOC 暂不支持该播放速度。',
  errorProfileInvalid: '检测到 JOC 流，但当前流没有提供可用的 JOC 配置。',
  errorMediaUnavailable: '检测到 JOC 流，但音频分片无法完整获取。',
  errorDecodeFailed: '检测到 JOC 流，但 OpenJOC 无法完成当前音频的解码。',
  nonJocTitle: '未检测到 JOC 音频',
  nonJocBody: '当前页面保持原生音频输出。',
  nonJocStatus: '页面音频状态',
  defaultVirtualLayout: '默认 7.1.4',
};

const EN_MESSAGES: OverlayMessages = {
  panelAriaLabel: 'OpenJOC audio controller',
  detectedTitle: 'JOC audio detected',
  detectedBody: 'This video contains an E-AC-3 JOC stream.',
  dismissDetection: 'Dismiss detection notice',
  enable: 'Enable',
  enableOpenJoc: 'Enable OpenJOC',
  expandPanel: 'Expand the OpenJOC panel',
  collapsePanel: 'Collapse the OpenJOC controller',
  closeErrorPanel: 'Close the error panel',
  closeNotice: 'Close the notice',
  statusEnabledDiagnostics: 'Enabled · Advanced',
  statusPreparing: 'Preparing',
  statusReady: 'Enabled · Waiting for audio',
  statusPaused: 'Enabled · Paused',
  statusBuffering: 'Enabled · Buffering',
  statusActive: 'Enabled',
  statusEnabled: 'Enabled',
  currentAudio: 'CURRENT AUDIO',
  outputMode: 'Output mode',
  rendererStereo: 'Stereo (Speakers)',
  rendererBinaural: 'Binaural (Headphones)',
  dialnormField: 'Program level',
  dialnormCalibrated: 'Calibrated (Recommended)',
  dialnormUnity: 'Unity / Compatibility mode',
  dialnormCalibratedHelp: 'Follows the programme Dialnorm metadata.',
  dialnormUnityHelp: 'Disables Dialnorm attenuation and favours compatibility.',
  healthAriaLabel: 'Playback health',
  healthSync: 'A/V sync',
  healthLoudness: 'Average loudness',
  waitingForData: 'Waiting for data',
  advancedEntry: 'Advanced',
  advancedEntryHint: 'Technical info',
  disableOpenJoc: 'Disable OpenJOC',
  advancedDiagnostics: 'Advanced diagnostics',
  liveSnapshot: 'Live snapshot',
  languageField: 'Language',
  languageHelp: 'Switches the controller language and remembers the choice.',
  customGain: 'Custom gain',
  customGainValueAria: 'Custom gain value',
  customGainHelp: '0 dB keeps the original level; large boosts can clip.',
  reset: 'Reset',
  diagGroupDecoder: 'Decoder',
  diagGroupInput: 'Input',
  diagGroupProfile: 'Profile',
  diagGroupAudio: 'Audio',
  diagGroupRealtime: 'Realtime',
  diagGroupMemory: 'Memory',
  diagGroupBinaural: 'Binaural',
  diagDecoder: 'Decoder',
  diagInput: 'Input',
  diagStatus: 'Status',
  diagProfile: 'Profile',
  diagStage: 'Stage',
  diagSampleRate: 'Sample rate',
  diagOutputChannels: 'Output channels',
  diagRenderer: 'Renderer',
  diagDrift: 'A/V offset',
  diagLoudness: 'Average loudness',
  diagBuffer: 'Buffer',
  diagUnderruns: 'Underruns',
  diagDecodeP95: 'Decode p95',
  diagRealtimeFactor: 'Realtime factor',
  diagWasmCurrent: 'WASM current',
  diagWasmPeak: 'WASM peak',
  diagVirtualLayout: 'Virtual layout',
  diagHrtf: 'HRTF',
  diagBinauralLatency: 'Binaural latency',
  diagBinauralP95: 'Binaural p95',
  waitingForProfile: 'Waiting for JOC profile',
  alwaysEnableOpenJoc: 'Always enable OpenJOC',
  rawDiagnosticsJson: 'Raw diagnostics JSON',
  copyJson: 'Copy JSON',
  collapseDiagnostics: 'Hide advanced diagnostics',
  copied: 'Copied',
  copyFailed: 'Copy failed, select it manually',
  errorStatus: 'Playback failed',
  errorEyebrow: 'PLAYBACK CANNOT CONTINUE',
  errorTitle: 'Unable to decode JOC audio',
  errorReasonLabel: 'Reason',
  errorCodeLabel: 'Error code',
  errorDefaultReason: 'OpenJOC did not return a more specific failure reason.',
  errorHint: 'Try refreshing the page and starting again.',
  returnNativeAudio: 'Return to native audio',
  details: 'Details',
  errorUnderlyingReason: 'Underlying reason',
  errorFailedStage: 'Failed stage',
  errorNativeDecoder: 'Native Dolby decoder',
  errorNativeDecoderUnused: 'Not used',
  errorUnknownStage: 'unknown',
  errorRateUnsupported: 'The playback rate is not 1.0x, which OpenJOC does not support yet.',
  errorProfileInvalid: 'A JOC stream was detected, but it did not provide a usable JOC profile.',
  errorMediaUnavailable: 'A JOC stream was detected, but its audio segments could not be fetched completely.',
  errorDecodeFailed: 'A JOC stream was detected, but OpenJOC could not decode the current audio.',
  nonJocTitle: 'No JOC audio detected',
  nonJocBody: 'This page keeps using native audio output.',
  nonJocStatus: 'Page audio status',
  defaultVirtualLayout: '7.1.4 (Default)',
};

const OVERLAY_MESSAGES: Readonly<Record<OverlayLanguage, OverlayMessages>> = {
  'zh-CN': ZH_CN_MESSAGES,
  en: EN_MESSAGES,
};

/** Looks up one interface string. Unknown keys and languages fall back to the default locale. */
export function overlayMessage(language: OverlayLanguage, key: OverlayMessageKey): string {
  const messages = OVERLAY_MESSAGES[language] ?? ZH_CN_MESSAGES;
  return messages[key] ?? ZH_CN_MESSAGES[key];
}
