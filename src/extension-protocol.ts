// pattern: Functional Core

import {isOutputGainDb} from './output-gain.js';

export type MediaKey = Readonly<{
  readonly bvid: string;
  readonly aid: string;
  readonly cid: string;
}>;

export type BilibiliAudioCandidate = Readonly<{
  readonly id: string;
  readonly source: 'dolby' | 'ec-3';
  readonly codecs: string | null;
  readonly mimeType: string | null;
  readonly bandwidth: number | null;
  readonly baseUrl: string;
  readonly backupUrls: ReadonlyArray<string>;
}>;

export type MainBridgeMessage =
  | Readonly<{source: 'openjoc-bilibili'; type: 'manifest'; pageOrigin: string; pageUrl: string; mediaKey: MediaKey; candidates: ReadonlyArray<BilibiliAudioCandidate>}>
  | Readonly<{source: 'openjoc-bilibili'; type: 'unavailable'; pageOrigin: string; pageUrl: string; reason: string}>;

export type PlaybackPhase = 'disabled' | 'preparing' | 'ready' | 'active' | 'paused' | 'buffering' | 'error';

export type RendererMode = 'stereo' | 'binaural';

export type PlaybackMetrics = Readonly<{
  readonly stage: string;
  readonly renderer: RendererMode;
  readonly virtualLayout: '7.1.4' | null;
  readonly hrtf: 'Built-in SADIE II D1' | null;
  readonly binauralLatencyMs: number | null;
  readonly binauralP95Ms: number | null;
  readonly binauralMaxMs: number | null;
  readonly currentVideoMediaTime: number | null;
  readonly currentAudioMediaTime: number | null;
  readonly driftMs: number | null;
  readonly averageDb: number | null;
  readonly driftP50Ms: number | null;
  readonly driftP95Ms: number | null;
  readonly driftMaxMs: number | null;
  readonly resyncCount: number;
  readonly compressedBufferMs: number;
  readonly pcmBufferMs: number;
  readonly underrunCount: number;
  readonly decodeMeanMs: number;
  readonly decodeP95Ms: number;
  readonly decodeMaxMs: number;
  readonly realtimeFactor: number | null;
  readonly peakWasmMemoryBytes: number;
  readonly mediaUrl: string | null;
  readonly audioContextTime: number | null;
  readonly audioPerformanceTime: number | null;
  readonly baseLatencyMs: number | null;
  readonly outputLatencyMs: number | null;
  readonly decodedAccessUnits: number;
  readonly outputFrames: number;
  readonly outputSamples: number;
  readonly workletProcessGapMaxMs: number;
  readonly workletProcessGapOver20MsCount: number;
  readonly workletPlayedQuantumCount: number;
  readonly workletSilentQuantumCount: number;
  readonly workletLastReadType: string | null;
}>;

export type RuntimeMessage =
  | Readonly<{target: 'background'; type: 'toggle'}>
  | Readonly<{target: 'background'; type: 'document-active'}>
  | Readonly<{target: 'background'; type: 'request-session'; force?: boolean; requestId?: string; generation?: number}>
  | Readonly<{target: 'background'; type: 'request-manifest'; pageUrl: string}>
  | Readonly<{target: 'background'; type: 'page-media-range-request'; tabId: number; generation: number; requestId: string; url: string; start: number; end: number}>
  | Readonly<{target: 'background'; type: 'page-media-range-response'; tabId: number; generation: number; requestId: string; status: number; contentRange: string | null; error: string | null; bufferBase64: string}>
  | Readonly<{target: 'background'; type: 'start'; requestId: string; pageUrl: string; mediaKey: MediaKey; candidates: ReadonlyArray<BilibiliAudioCandidate>; generation: number; videoTimeSamples: number; dialnorm: 'calibrated' | 'unity'; renderer: RendererMode; gainDb?: number}>
  | Readonly<{target: 'background'; type: 'manifest'; pageUrl: string; mediaKey: MediaKey; candidates: ReadonlyArray<BilibiliAudioCandidate>; generation: number}>
  | Readonly<{target: 'background'; type: 'session-heartbeat'; requestId: string; pageUrl: string; mediaKey: MediaKey; generation: number}>
  | Readonly<{target: 'background'; type: 'video-clock'; requestId: string; pageUrl: string; mediaKey: MediaKey; generation: number; mediaTimeSamples: number; paused: boolean; buffering: boolean; playbackRate: number; expectedDisplayTimeMs: number | null}>
  | Readonly<{target: 'background'; type: 'native-muted'; generation: number}>
  | Readonly<{target: 'background'; type: 'player-volume'; requestId: string; generation: number; volume: number; muted: boolean; activate: boolean}>
  | Readonly<{target: 'offscreen'; type: 'player-volume'; requestId: string; tabId: number; generation: number; volume: number; muted: boolean; activate: boolean}>
  | Readonly<{target: 'background'; type: 'disable'; mediaKey: MediaKey; generation: number}>
  | Readonly<{target: 'background'; type: 'dialnorm'; generation: number; mode: 'calibrated' | 'unity'}>
  | Readonly<{target: 'background'; type: 'output-gain'; requestId: string; generation: number; gainDb: number}>
  | Readonly<{target: 'offscreen'; type: 'start'; requestId: string; tabId: number; pageUrl: string; mediaKey: MediaKey; candidate: BilibiliAudioCandidate; generation: number; videoTimeSamples: number; dialnorm: 'calibrated' | 'unity'; renderer: RendererMode; gainDb?: number}>
  | Readonly<{target: 'offscreen'; type: 'output-gain'; requestId: string; tabId: number; generation: number; gainDb: number}>
  | Readonly<{target: 'offscreen'; type: 'clock'; tabId: number; generation: number; mediaTimeSamples: number; paused: boolean; buffering: boolean; playbackRate: number; expectedDisplayTimeMs: number | null}>
  | Readonly<{target: 'offscreen'; type: 'native-muted'; tabId: number; generation: number}>
  | Readonly<{target: 'offscreen'; type: 'disable'; tabId: number; mediaKey: MediaKey; generation: number}>
  | Readonly<{target: 'offscreen'; type: 'dialnorm'; tabId: number; generation: number; mode: 'calibrated' | 'unity'}>
  | Readonly<{target: 'offscreen'; type: 'page-media-range-response'; tabId: number; generation: number; requestId: string; status: number; contentRange: string | null; error: string | null; bufferBase64: string}>
  | Readonly<{target: 'background'; type: 'offscreen-status'; requestId: string; tabId: number; mediaKey: MediaKey; generation: number; phase: PlaybackPhase; reason: string | null; inbandJocConfirmed: boolean; profile: string | null; metrics: PlaybackMetrics}>;

export type LegacyOffscreenStatus = Readonly<{
  readonly target: 'background';
  readonly type: 'offscreen-status';
  readonly tabId: number;
  readonly generation: number;
}>;

/** Validates untrusted MAIN-world data before it reaches extension code. */
export function isMainBridgeMessage(value: unknown): value is MainBridgeMessage {
  if (!isRecord(value) || value.source !== 'openjoc-bilibili' || typeof value.pageOrigin !== 'string' || value.pageOrigin !== 'https://www.bilibili.com' || typeof value.pageUrl !== 'string') {
    return false;
  }
  if (value.type === 'manifest') {
    return isMediaKey(value.mediaKey) && isCandidateArray(value.candidates);
  }
  return value.type === 'unavailable' && typeof value.reason === 'string' && value.reason.length > 0;
}

/** Validates every message that crosses the extension runtime boundary. */
export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!isRecord(value) || typeof value.target !== 'string' || typeof value.type !== 'string') return false;
  if (value.target === 'background' && value.type === 'toggle') return true;
  if (value.target === 'background' && value.type === 'document-active') return true;
  if (value.type === 'output-gain' && (value.target === 'background' || value.target === 'offscreen')) {
    return isNonEmptyString(value.requestId) && isGeneration(value.generation) && isOutputGainDb(value.gainDb)
      && (value.target === 'background' || isTabId(value.tabId));
  }
  if (value.target === 'background' && value.type === 'request-session') {
    return (value.force === undefined || typeof value.force === 'boolean')
      && (value.requestId === undefined || isNonEmptyString(value.requestId))
      && (value.generation === undefined || isGeneration(value.generation));
  }
  if (value.target === 'background' && value.type === 'request-manifest') return typeof value.pageUrl === 'string';
  if (value.target === 'background' && value.type === 'page-media-range-request') {
    return isTabId(value.tabId) && isGeneration(value.generation) && isNonEmptyString(value.requestId)
      && isNonEmptyString(value.url) && isNonNegativeFinite(value.start) && isNonNegativeFinite(value.end)
      && Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end) && value.end >= value.start
      && value.end - value.start + 1 <= 4 * 1024 * 1024;
  }
  if (value.target === 'background' && value.type === 'page-media-range-response') {
    return isTabId(value.tabId) && isGeneration(value.generation) && isNonEmptyString(value.requestId)
      && isNonNegativeFinite(value.status) && Number.isSafeInteger(value.status)
      && isNullableString(value.contentRange) && isNullableString(value.error) && isBase64String(value.bufferBase64);
  }
  if (value.target === 'background' && value.type === 'start') {
    return isNonEmptyString(value.requestId) && typeof value.pageUrl === 'string' && isMediaKey(value.mediaKey) && isCandidateArray(value.candidates)
      && isGeneration(value.generation) && isNonNegativeFinite(value.videoTimeSamples)
      && (value.dialnorm === 'calibrated' || value.dialnorm === 'unity') && isRendererMode(value.renderer)
      && (value.gainDb === undefined || isOutputGainDb(value.gainDb));
  }
  if (value.target === 'background' && value.type === 'manifest') {
    return typeof value.pageUrl === 'string' && isMediaKey(value.mediaKey) && isCandidateArray(value.candidates) && isGeneration(value.generation);
  }
  if (value.target === 'background' && value.type === 'session-heartbeat') {
    return isNonEmptyString(value.requestId) && typeof value.pageUrl === 'string' && isMediaKey(value.mediaKey) && isGeneration(value.generation);
  }
  if (value.target === 'background' && value.type === 'video-clock') {
    return isNonEmptyString(value.requestId) && typeof value.pageUrl === 'string' && isMediaKey(value.mediaKey) && isGeneration(value.generation)
      && isNonNegativeFinite(value.mediaTimeSamples) && typeof value.paused === 'boolean'
      && typeof value.buffering === 'boolean' && isFiniteNumber(value.playbackRate)
      && isNullableFiniteNumber(value.expectedDisplayTimeMs);
  }
  if (value.target === 'background' && value.type === 'native-muted') {
    return isGeneration(value.generation);
  }
  if ((value.target === 'background' || value.target === 'offscreen') && value.type === 'player-volume') {
    return isNonEmptyString(value.requestId) && isGeneration(value.generation)
      && isFiniteNumber(value.volume) && value.volume >= 0 && value.volume <= 1
      && typeof value.muted === 'boolean' && typeof value.activate === 'boolean'
      && (value.target === 'background' || isTabId(value.tabId));
  }
  if (value.target === 'background' && value.type === 'disable') return isMediaKey(value.mediaKey) && isGeneration(value.generation);
  if (value.target === 'background' && value.type === 'dialnorm') {
    return isGeneration(value.generation) && (value.mode === 'calibrated' || value.mode === 'unity');
  }
  if (value.target === 'offscreen' && value.type === 'start') {
    return isNonEmptyString(value.requestId) && isTabId(value.tabId) && typeof value.pageUrl === 'string' && isMediaKey(value.mediaKey)
      && isCandidate(value.candidate) && isGeneration(value.generation)
      && isNonNegativeFinite(value.videoTimeSamples)
      && (value.dialnorm === 'calibrated' || value.dialnorm === 'unity') && isRendererMode(value.renderer)
      && (value.gainDb === undefined || isOutputGainDb(value.gainDb));
  }
  if (value.target === 'offscreen' && value.type === 'clock') {
    return isTabId(value.tabId) && isGeneration(value.generation) && isNonNegativeFinite(value.mediaTimeSamples)
      && typeof value.paused === 'boolean' && typeof value.buffering === 'boolean'
      && isFiniteNumber(value.playbackRate) && isNullableFiniteNumber(value.expectedDisplayTimeMs);
  }
  if (value.target === 'offscreen' && value.type === 'native-muted') {
    return isTabId(value.tabId) && isGeneration(value.generation);
  }
  if (value.target === 'offscreen' && value.type === 'disable') return isTabId(value.tabId) && isMediaKey(value.mediaKey) && isGeneration(value.generation);
  if (value.target === 'offscreen' && value.type === 'dialnorm') {
    return isTabId(value.tabId) && isGeneration(value.generation) && (value.mode === 'calibrated' || value.mode === 'unity');
  }
  if (value.target === 'offscreen' && value.type === 'page-media-range-response') {
    return isTabId(value.tabId) && isGeneration(value.generation) && isNonEmptyString(value.requestId)
      && isNonNegativeFinite(value.status) && Number.isSafeInteger(value.status)
      && isNullableString(value.contentRange) && isNullableString(value.error) && isBase64String(value.bufferBase64);
  }
  if (value.target === 'background' && value.type === 'offscreen-status') {
      return isNonEmptyString(value.requestId) && isTabId(value.tabId) && isMediaKey(value.mediaKey) && isGeneration(value.generation) && isPlaybackPhase(value.phase)
      && isNullableString(value.reason) && typeof value.inbandJocConfirmed === 'boolean'
      && isNullableString(value.profile) && isPlaybackMetrics(value.metrics);
  }
  return false;
}

export function isLegacyOffscreenStatus(value: unknown): value is LegacyOffscreenStatus {
  return isRecord(value)
    && value.target === 'background'
    && value.type === 'offscreen-status'
    && value.requestId === undefined
    && isTabId(value.tabId)
    && isGeneration(value.generation);
}

function isMediaKey(value: unknown): value is MediaKey {
  return isRecord(value) && isNonEmptyString(value.bvid) && isNonEmptyString(value.aid) && isNonEmptyString(value.cid);
}

function isCandidateArray(value: unknown): value is ReadonlyArray<BilibiliAudioCandidate> {
  return Array.isArray(value) && value.every((candidate) => isCandidate(candidate));
}

function isCandidate(value: unknown): value is BilibiliAudioCandidate {
  return isRecord(value) && isNonEmptyString(value.id)
    && (value.source === 'dolby' || value.source === 'ec-3')
    && isNullableString(value.codecs) && isNullableString(value.mimeType)
    && isNullableFiniteNumber(value.bandwidth) && isNonEmptyString(value.baseUrl)
    && Array.isArray(value.backupUrls) && value.backupUrls.every((url) => typeof url === 'string');
}

function isPlaybackMetrics(value: unknown): value is PlaybackMetrics {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.stage)
    && isRendererMode(value.renderer)
    && (value.virtualLayout === null || value.virtualLayout === '7.1.4')
    && (value.hrtf === null || value.hrtf === 'Built-in SADIE II D1')
    && isNullableFiniteNumber(value.binauralLatencyMs)
    && isNullableFiniteNumber(value.binauralP95Ms)
    && isNullableFiniteNumber(value.binauralMaxMs)
    && isNullableFiniteNumber(value.currentVideoMediaTime)
    && isNullableFiniteNumber(value.currentAudioMediaTime)
    && isNullableFiniteNumber(value.driftMs)
    && isNullableFiniteNumber(value.averageDb)
    && isNullableFiniteNumber(value.driftP50Ms)
    && isNullableFiniteNumber(value.driftP95Ms)
    && isNullableFiniteNumber(value.driftMaxMs)
    && isGeneration(value.resyncCount)
    && isNonNegativeFinite(value.compressedBufferMs)
    && isNonNegativeFinite(value.pcmBufferMs)
    && isGeneration(value.underrunCount)
    && isNonNegativeFinite(value.decodeMeanMs)
    && isNonNegativeFinite(value.decodeP95Ms)
    && isNonNegativeFinite(value.decodeMaxMs)
    && isNullableFiniteNumber(value.realtimeFactor)
    && isNonNegativeFinite(value.peakWasmMemoryBytes)
    && isNullableString(value.mediaUrl)
    && isNullableFiniteNumber(value.audioContextTime)
    && isNullableFiniteNumber(value.audioPerformanceTime)
    && isNullableFiniteNumber(value.baseLatencyMs)
    && isNullableFiniteNumber(value.outputLatencyMs)
    && isNonNegativeFinite(value.decodedAccessUnits)
    && isNonNegativeFinite(value.outputFrames)
    && isNonNegativeFinite(value.outputSamples)
    && isNonNegativeFinite(value.workletProcessGapMaxMs)
    && isNonNegativeFinite(value.workletProcessGapOver20MsCount)
    && isNonNegativeFinite(value.workletPlayedQuantumCount)
    && isNonNegativeFinite(value.workletSilentQuantumCount)
    && isNullableString(value.workletLastReadType);
}

function isPlaybackPhase(value: unknown): value is PlaybackPhase {
  return value === 'disabled' || value === 'preparing' || value === 'ready' || value === 'active'
    || value === 'paused' || value === 'buffering' || value === 'error';
}

function isRendererMode(value: unknown): value is RendererMode {
  return value === 'stereo' || value === 'binaural';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isBase64String(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 5_592_408 && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isGeneration(value: unknown): value is number {
  return isNonNegativeFinite(value) && Number.isSafeInteger(value);
}

function isTabId(value: unknown): value is number {
  return isGeneration(value) && value > 0;
}
