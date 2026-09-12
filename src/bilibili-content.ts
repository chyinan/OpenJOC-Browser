// pattern: Imperative Shell

import {createJocOverlayController, type JocOverlayController} from './joc-overlay-controller.js';
import {isRuntimeMessage, type PlaybackMetrics, type PlaybackPhase, type RendererMode} from './extension-protocol.js';
import {type DialnormMode, type OverlayRenderer} from './joc-overlay-state.js';
import {normalizeOutputGainDb} from './output-gain.js';
import {acknowledgeStart, createStartHandshake, nextStartHandshakeAction, recordStartAttempt, shouldAcceptPlaybackStatus, shouldDispatchSessionRecovery, shouldExpirePlaybackStatus, shouldRestartAfterSeek, type StartHandshakeState} from './start-handshake.js';

(function (): void {

type ContentMediaKey = Readonly<{readonly bvid: string; readonly aid: string; readonly cid: string}>;
type ContentCandidate = Readonly<{readonly id: string; readonly source: 'dolby' | 'ec-3'; readonly codecs: string | null; readonly mimeType: string | null; readonly bandwidth: number | null; readonly baseUrl: string; readonly backupUrls: ReadonlyArray<string>}>;
type ContentManifest = Readonly<{readonly source: 'openjoc-bilibili'; readonly type: 'manifest'; readonly pageOrigin: string; readonly pageUrl: string; readonly mediaKey: ContentMediaKey; readonly candidates: ReadonlyArray<ContentCandidate>}>;
type ContentUnavailable = Readonly<{readonly source: 'openjoc-bilibili'; readonly type: 'unavailable'; readonly pageOrigin: string; readonly pageUrl: string; readonly reason: string}>;
type ContentStatus = Readonly<{readonly target: 'background'; readonly type: 'offscreen-status'; readonly requestId: string; readonly tabId: number; readonly mediaKey: ContentMediaKey; readonly generation: number; readonly phase: PlaybackPhase; readonly reason: string | null; readonly inbandJocConfirmed: boolean; readonly profile: string | null; readonly metrics: PlaybackMetrics}>;
type ContentToggle = Readonly<{readonly target: 'background'; readonly type: 'toggle'}>;
type ContentRequestSession = Readonly<{readonly target: 'background'; readonly type: 'request-session'; readonly force?: boolean; readonly requestId?: string; readonly generation?: number}>;
type ContentPageRangeRequest = Readonly<{readonly target: 'background'; readonly type: 'page-media-range-request'; readonly tabId: number; readonly generation: number; readonly requestId: string; readonly url: string; readonly start: number; readonly end: number}>;
type ContentPageRangeResponse = Readonly<{readonly source: 'openjoc-bilibili'; readonly type: 'media-range-response'; readonly pageOrigin: string; readonly pageUrl: string; readonly requestId: string; readonly status: number; readonly contentRange: string | null; readonly error: string | null; readonly buffer: ArrayBuffer}>;

const PAGE_ORIGIN = 'https://www.bilibili.com';
const MEDIA_SUFFIX = '.bilivideo.com';
const SAMPLE_RATE = 48_000;
const CLOCK_INTERVAL_MS = 100;
const SESSION_HEARTBEAT_INTERVAL_MS = 1_000;
const START_ACKNOWLEDGEMENT_TIMEOUT_MS = 35_000;
const ALWAYS_ENABLED_STORAGE_KEY = 'alwaysEnableOpenJoc';
const DIALNORM_STORAGE_KEY = 'dialnormMode';
const RENDERER_STORAGE_KEY = 'rendererMode';
const OUTPUT_GAIN_STORAGE_KEY = 'outputGainDb';
let video: HTMLVideoElement | null = null;
let videoGeneration = 0;
let latestManifest: ContentManifest | null = null;
let hasUnmutedPlayback = false;
let nativeControl: {video: HTMLVideoElement; token: string; requestId: string; generation: number; acknowledged: boolean; requestedAt: number} | null = null;
let isOpenJocRequested = false;
let latestStatus: ContentStatus | null = null;
let dialnormMode: DialnormMode = 'calibrated';
let rendererMode: RendererMode = 'stereo';
let outputGainDb = 0;
let alwaysEnableOpenJoc = false;
let alwaysEnableAutoStartPending = false;
let alwaysEnabledPreferenceChanged = false;
let dialnormPreferenceChanged = false;
let rendererPreferenceChanged = false;
let outputGainPreferenceChanged = false;
let playbackPreferencesLoaded = false;
let deferredManualEnable: boolean | null = null;
let startHandshake: StartHandshakeState = createStartHandshake();
let activeStartRequestId: string | null = null;
let pendingSeekRestart = false;
let lastStatusAt = performance.now();
let lastSessionHeartbeatAt = 0;
let lastLocation = location.href;
let clockTimer: number | null = null;
let frameCallbackId: number | null = null;
const pendingPageRangeRequests = new Map<string, ContentPageRangeRequest>();
const lifecycleTrace: Array<Readonly<Record<string, unknown>>> = [];

const overlay: JocOverlayController = createJocOverlayController({
  onEnable: (options): void => {
    dialnormMode = options.dialnorm;
    rendererMode = rendererModeFromOverlay(options.renderer);
    alwaysEnableAutoStartPending = false;
    enableOpenJoc();
  },
  onDisable: (): void => {
    if (!playbackPreferencesLoaded) deferredManualEnable = false;
    alwaysEnableAutoStartPending = false;
    disableOpenJoc('manual');
  },
  onRendererChange: (renderer): void => {
    rendererPreferenceChanged = true;
    rendererMode = rendererModeFromOverlay(renderer);
    void chrome.storage.local.set({[RENDERER_STORAGE_KEY]: rendererMode}).catch(() => undefined);
    if (isOpenJocRequested) enableOpenJoc();
  },
  onDialnormChange: (mode): void => {
    dialnormPreferenceChanged = true;
    dialnormMode = mode;
    void chrome.storage.local.set({[DIALNORM_STORAGE_KEY]: mode}).catch(() => undefined);
    send({target: 'background', type: 'dialnorm', generation: videoGeneration, mode});
  },
  onAlwaysEnabledChange: (enabled): void => {
    alwaysEnabledPreferenceChanged = true;
    alwaysEnableOpenJoc = enabled;
    alwaysEnableAutoStartPending = enabled;
    void chrome.storage.local.set({[ALWAYS_ENABLED_STORAGE_KEY]: enabled}).catch(() => undefined);
    maybeEnableAlways();
  },
  onGainChange: (gainDb): void => {
    outputGainPreferenceChanged = true;
    outputGainDb = normalizeOutputGainDb(gainDb);
    void chrome.storage.local.set({[OUTPUT_GAIN_STORAGE_KEY]: outputGainDb}).catch(() => undefined);
    if (isOpenJocRequested && activeStartRequestId !== null) {
      send({target: 'background', type: 'output-gain', requestId: activeStartRequestId, generation: videoGeneration, gainDb: outputGainDb});
    }
  },
  onReturnNative: (): void => {
    if (!playbackPreferencesLoaded) deferredManualEnable = false;
    disableOpenJoc('return-native');
  },
});

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function rendererModeFromOverlay(renderer: OverlayRenderer): RendererMode {
  return renderer === 'binaural-headphones' ? 'binaural' : 'stereo';
}

function isMediaKey(value: unknown): value is ContentMediaKey {
  const candidate = record(value);
  return candidate !== null && isString(candidate.bvid) && candidate.bvid.length > 0 && isString(candidate.aid) && candidate.aid.length > 0 && isString(candidate.cid) && candidate.cid.length > 0;
}

function isCandidate(value: unknown): value is ContentCandidate {
  const candidate = record(value);
  return candidate !== null && isString(candidate.id) && candidate.id.length > 0 && (candidate.source === 'dolby' || candidate.source === 'ec-3') && (candidate.codecs === null || isString(candidate.codecs)) && (candidate.mimeType === null || isString(candidate.mimeType)) && (candidate.bandwidth === null || isFiniteNumber(candidate.bandwidth)) && isString(candidate.baseUrl) && Array.isArray(candidate.backupUrls) && candidate.backupUrls.every(isString);
}

function isManifestMessage(value: unknown): value is ContentManifest {
  const candidate = record(value);
  return candidate !== null && candidate.source === 'openjoc-bilibili' && candidate.type === 'manifest' && candidate.pageOrigin === PAGE_ORIGIN && isString(candidate.pageUrl) && isMediaKey(candidate.mediaKey) && Array.isArray(candidate.candidates) && candidate.candidates.length > 0 && candidate.candidates.every(isCandidate);
}

function isUnavailableMessage(value: unknown): value is ContentUnavailable {
  const candidate = record(value);
  return candidate !== null && candidate.source === 'openjoc-bilibili' && candidate.type === 'unavailable' && candidate.pageOrigin === PAGE_ORIGIN && isString(candidate.pageUrl) && isString(candidate.reason) && candidate.reason.length > 0;
}

function isCurrentPageMessage(pageUrl: string): boolean {
  return pageUrl === location.href;
}

function isStatusMessage(value: unknown): value is ContentStatus {
  return isRuntimeMessage(value) && value.target === 'background' && value.type === 'offscreen-status';
}

function isToggleMessage(value: unknown): value is ContentToggle {
  const candidate = record(value);
  return candidate !== null && candidate.target === 'background' && candidate.type === 'toggle';
}

function isRequestSessionMessage(value: unknown): value is ContentRequestSession {
  return isRuntimeMessage(value) && value.target === 'background' && value.type === 'request-session';
}

function isPageRangeRequest(value: unknown): value is ContentPageRangeRequest {
  const candidate = record(value);
  const start = candidate?.start;
  const end = candidate?.end;
  return candidate !== null && candidate.target === 'background' && candidate.type === 'page-media-range-request' && isFiniteNumber(candidate.tabId) && Number.isSafeInteger(candidate.tabId) && isFiniteNumber(candidate.generation) && Number.isSafeInteger(candidate.generation) && isString(candidate.requestId) && candidate.requestId.length > 0 && isString(candidate.url) && isFiniteNumber(start) && isFiniteNumber(end) && Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start && end - start + 1 <= 4 * 1024 * 1024;
}

function isPageRangeResponse(value: unknown): value is ContentPageRangeResponse {
  const candidate = record(value);
  return candidate !== null && candidate.source === 'openjoc-bilibili' && candidate.type === 'media-range-response' && candidate.pageOrigin === PAGE_ORIGIN && isString(candidate.pageUrl) && isString(candidate.requestId) && isFiniteNumber(candidate.status) && Number.isSafeInteger(candidate.status) && (candidate.contentRange === null || isString(candidate.contentRange)) && (candidate.error === null || isString(candidate.error)) && candidate.buffer instanceof ArrayBuffer;
}

function traceLifecycle(event: string, details: Readonly<Record<string, unknown>> = {}): void {
  const entry = {
    atMs: Math.round(performance.now()),
    event,
    generation: videoGeneration,
    mediaKey: latestManifest === null ? null : mediaKeyString(latestManifest.mediaKey),
    requested: isOpenJocRequested,
    requestId: activeStartRequestId,
    startAttempts: startHandshake.attempts,
    ...details,
  };
  lifecycleTrace.push(entry);
  if (lifecycleTrace.length > 20) lifecycleTrace.shift();
  overlay.setDebugSummary(JSON.stringify({revision: 'request-aware-recovery-3', latest: entry, trace: lifecycleTrace}));
  console.info('[OpenJOC lifecycle]', JSON.stringify(entry));
}

function send(message: unknown): void {
  const messageRecord = record(message);
  const messageType = isString(messageRecord?.type) ? messageRecord.type : 'unknown';
  void chrome.runtime.sendMessage(message).catch((error: unknown) => {
    traceLifecycle('runtime-send-failed', {messageType, reason: error instanceof Error ? error.message : String(error)});
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function mediaKeyString(key: ContentMediaKey): string {
  return `${key.bvid}:${key.aid}:${key.cid}`;
}

function approvedMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '' && (url.hostname === 'bilivideo.com' || url.hostname.endsWith(MEDIA_SUFFIX)) && url.pathname.toLowerCase().endsWith('.m4s');
  } catch {
    return false;
  }
}

function findMasterVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video'));
  return videos.sort((left, right) => (right.clientWidth * right.clientHeight) - (left.clientWidth * left.clientHeight))[0] ?? null;
}

function currentCandidate(): ContentCandidate | null {
  const candidate = latestManifest?.candidates.find((entry) => entry.source === 'dolby' || entry.codecs?.toLowerCase().includes('ec-3') === true) ?? null;
  return candidate !== null && approvedMediaUrl(candidate.baseUrl) && candidate.backupUrls.every(approvedMediaUrl) ? candidate : null;
}

function dispatchStartRequest(): boolean {
  const manifest = latestManifest;
  const candidate = currentCandidate();
  const currentVideo = video;
  if (manifest === null || candidate === null || currentVideo === null) return false;
  activeStartRequestId = crypto.randomUUID();
  startHandshake = recordStartAttempt(startHandshake, performance.now());
  traceLifecycle('start-attempt', {attempt: startHandshake.attempts, videoTimeSamples: Math.max(0, Math.round(currentVideo.currentTime * SAMPLE_RATE))});
  send({target: 'background', type: 'start', requestId: activeStartRequestId, pageUrl: location.href, mediaKey: manifest.mediaKey, candidates: manifest.candidates, generation: videoGeneration, videoTimeSamples: Math.max(0, Math.round(currentVideo.currentTime * SAMPLE_RATE)), paused: currentVideo.paused, buffering: currentVideo.readyState < 3, dialnorm: dialnormMode, renderer: rendererMode, gainDb: outputGainDb});
  emitClock();
  return true;
}

function advanceStartHandshake(nowMs: number): void {
  if (!isOpenJocRequested || latestStatus !== null) return;
  const action = nextStartHandshakeAction(startHandshake, nowMs, START_ACKNOWLEDGEMENT_TIMEOUT_MS);
  if (action === 'give-up') {
    traceLifecycle('start-give-up');
    alwaysEnableAutoStartPending = false;
    disableOpenJoc('start-give-up');
  }
}

function maybeEnableAlways(): void {
  if (!playbackPreferencesLoaded || !alwaysEnableOpenJoc || !alwaysEnableAutoStartPending || isOpenJocRequested || latestManifest === null || currentCandidate() === null || video === null) return;
  alwaysEnableAutoStartPending = false;
  enableOpenJoc();
}

async function restorePlaybackPreferences(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([ALWAYS_ENABLED_STORAGE_KEY, DIALNORM_STORAGE_KEY, RENDERER_STORAGE_KEY, OUTPUT_GAIN_STORAGE_KEY]);
    if (!dialnormPreferenceChanged) {
      dialnormMode = stored[DIALNORM_STORAGE_KEY] === 'unity' ? 'unity' : 'calibrated';
      overlay.setDialnorm(dialnormMode);
    }
    if (!rendererPreferenceChanged) {
      rendererMode = stored[RENDERER_STORAGE_KEY] === 'binaural' ? 'binaural' : 'stereo';
      overlay.setRenderer(rendererMode === 'binaural' ? 'binaural-headphones' : 'stereo-speakers');
    }
    if (!outputGainPreferenceChanged) {
      outputGainDb = normalizeOutputGainDb(stored[OUTPUT_GAIN_STORAGE_KEY]);
      overlay.setGainDb(outputGainDb);
    }
    if (!alwaysEnabledPreferenceChanged) {
      alwaysEnableOpenJoc = stored[ALWAYS_ENABLED_STORAGE_KEY] === true;
      alwaysEnableAutoStartPending = alwaysEnableOpenJoc;
      overlay.setAlwaysEnabled(alwaysEnableOpenJoc);
    }
    traceLifecycle('preference-restored', {alwaysEnabled: alwaysEnableOpenJoc, dialnorm: dialnormMode, renderer: rendererMode, gainDb: outputGainDb});
  } catch {
    // Keep the in-memory default when storage is unavailable.
  } finally {
    playbackPreferencesLoaded = true;
    const manualEnable = deferredManualEnable;
    deferredManualEnable = null;
    if (manualEnable !== null) {
      alwaysEnableAutoStartPending = false;
      if (manualEnable) enableOpenJoc();
    } else maybeEnableAlways();
  }
}

function emitSessionHeartbeat(): void {
  const manifest = latestManifest;
  if (!isOpenJocRequested || manifest === null || activeStartRequestId === null) return;
  const now = performance.now();
  if (now - lastSessionHeartbeatAt < SESSION_HEARTBEAT_INTERVAL_MS) return;
  lastSessionHeartbeatAt = now;
  send({target: 'background', type: 'session-heartbeat', requestId: activeStartRequestId, pageUrl: location.href, mediaKey: manifest.mediaKey, generation: videoGeneration});
}

function emitClock(force = false): void {
  if (!isOpenJocRequested || pendingSeekRestart || activeStartRequestId === null) return;
  emitSessionHeartbeat();
  const currentVideo = video;
  const manifest = latestManifest;
  if (currentVideo === null || manifest === null || !isOpenJocRequested) return;
  if (!force && document.visibilityState === 'hidden' && !currentVideo.paused) return;
  const currentTime = Number.isFinite(currentVideo.currentTime) ? Math.max(0, currentVideo.currentTime) : 0;
  send({target: 'background', type: 'video-clock', requestId: activeStartRequestId, pageUrl: location.href, mediaKey: manifest.mediaKey, generation: videoGeneration, mediaTimeSamples: Math.round(currentTime * SAMPLE_RATE), paused: currentVideo.paused, buffering: currentVideo.readyState < 3, playbackRate: currentVideo.playbackRate, expectedDisplayTimeMs: null});
}

function scheduleVideoFrameCallback(): void {
  const currentVideo = video as (HTMLVideoElement & {requestVideoFrameCallback?: (callback: (now: number, metadata: Readonly<{mediaTime: number; expectedDisplayTime: number}>) => void) => number; cancelVideoFrameCallback?: (id: number) => void}) | null;
  if (currentVideo === null || currentVideo.requestVideoFrameCallback === undefined) return;
  frameCallbackId = currentVideo.requestVideoFrameCallback((_now, metadata): void => {
    if (video === currentVideo) {
      const manifest = latestManifest;
      if (manifest !== null && isOpenJocRequested && !pendingSeekRestart && activeStartRequestId !== null) {
        send({target: 'background', type: 'video-clock', requestId: activeStartRequestId, pageUrl: location.href, mediaKey: manifest.mediaKey, generation: videoGeneration, mediaTimeSamples: Math.max(0, Math.round(metadata.mediaTime * SAMPLE_RATE)), paused: currentVideo.paused, buffering: currentVideo.readyState < 3, playbackRate: currentVideo.playbackRate, expectedDisplayTimeMs: metadata.expectedDisplayTime});
      }
      scheduleVideoFrameCallback();
    }
  });
}

function attachVideo(nextVideo: HTMLVideoElement): void {
  if (video === nextVideo) return;
  const oldVideo = video;
  if (oldVideo !== null) {
    const oldWithCancel = oldVideo as HTMLVideoElement & {cancelVideoFrameCallback?: (id: number) => void};
    if (frameCallbackId !== null) oldWithCancel.cancelVideoFrameCallback?.(frameCallbackId);
  }
  if (isOpenJocRequested) {
    disableOpenJoc('video-replaced');
  }
  video = nextVideo;
  hasUnmutedPlayback = !nextVideo.paused && !nextVideo.muted;
  videoGeneration += 1;
  latestManifest = null;
  overlay.reset();
  for (const eventName of ['play', 'pause', 'seeking', 'seeked', 'waiting', 'playing', 'canplay', 'stalled', 'timeupdate', 'ratechange', 'loadedmetadata', 'emptied', 'volumechange']) {
    nextVideo.addEventListener(eventName, (): void => {
      if (isOpenJocRequested && eventName === 'seeking') {
        pendingSeekRestart = true;
        activeStartRequestId = null;
        videoGeneration += 1;
        latestStatus = null;
        startHandshake = createStartHandshake();
        lastStatusAt = performance.now();
        overlay.setStatus(null);
        traceLifecycle('video-seeking', {currentTime: nextVideo.currentTime});
        return;
      }
      if (eventName === 'seeked') {
        const shouldRestart = shouldRestartAfterSeek(isOpenJocRequested, pendingSeekRestart);
        pendingSeekRestart = false;
        if (shouldRestart) {
          traceLifecycle('video-seeked-restart', {currentTime: nextVideo.currentTime});
          dispatchStartRequest();
          return;
        }
      }
      emitClock(eventName !== 'timeupdate' && eventName !== 'volumechange');
      if (eventName === 'play' || eventName === 'playing' || eventName === 'volumechange') suppressNativeAudio();
    });
  }
  scheduleVideoFrameCallback();
  window.postMessage({source: 'openjoc-content', type: 'request-manifest'}, PAGE_ORIGIN);
}

function restoreNativeAudio(): void {
  const previous = nativeControl;
  nativeControl = null;
  if (previous === null) return;
  window.postMessage({source: 'openjoc-content', type: 'release-audio-control', token: previous.token,
    requestId: previous.requestId, generation: previous.generation}, PAGE_ORIGIN);
}

function suppressNativeAudio(): void {
  const currentVideo = video;
  // Let Chromium observe one real, unmuted playback before the extension mutes the original track.
  // Taking control earlier makes a hidden page eligible for the browser's automatic pause policy.
  if (currentVideo === null || activeStartRequestId === null) return;
  if (!hasUnmutedPlayback && !currentVideo.paused && !currentVideo.muted) hasUnmutedPlayback = true;
  if (!hasUnmutedPlayback) return;
  if (nativeControl?.video === currentVideo && nativeControl.requestId === activeStartRequestId && nativeControl.generation === videoGeneration) return;
  const token = currentVideo.dataset.openjocAudioToken ?? crypto.randomUUID();
  currentVideo.dataset.openjocAudioToken = token;
  nativeControl = {video: currentVideo, token, requestId: activeStartRequestId, generation: videoGeneration, acknowledged: false, requestedAt: performance.now()};
  window.postMessage({source: 'openjoc-content', type: 'take-audio-control', token, requestId: activeStartRequestId, generation: videoGeneration}, PAGE_ORIGIN);
}

function applyStatus(status: ContentStatus): void {
  const activeMediaKey = latestManifest === null ? null : mediaKeyString(latestManifest.mediaKey);
  const statusMediaKey = mediaKeyString(status.mediaKey);
  if (!shouldAcceptPlaybackStatus(activeStartRequestId, activeMediaKey, status.requestId, statusMediaKey)) {
    traceLifecycle('status-rejected', {statusRequestId: status.requestId, statusMediaKey, statusGeneration: status.generation, phase: status.phase});
    return;
  }
  if (status.generation < videoGeneration) return;
  const previousPhase = latestStatus?.phase ?? null;
  const firstAcknowledgement = !startHandshake.acknowledged;
  startHandshake = acknowledgeStart(startHandshake);
  latestStatus = status;
  if (status.generation > videoGeneration) videoGeneration = status.generation;
  lastStatusAt = performance.now();
  if (firstAcknowledgement || previousPhase !== status.phase) traceLifecycle('status', {phase: status.phase, stage: status.metrics.stage, statusGeneration: status.generation});
  if (status.phase === 'ready' && status.inbandJocConfirmed) suppressNativeAudio();
  if (status.phase === 'disabled' || status.phase === 'error') {
    isOpenJocRequested = false;
    activeStartRequestId = null;
    alwaysEnableAutoStartPending = false;
    restoreNativeAudio();
  }
  overlay.setStatus(status);
  if (status.phase === 'disabled' || status.phase === 'error') overlay.setRequested(false);
}

function enableOpenJoc(): void {
  if (!playbackPreferencesLoaded) {
    deferredManualEnable = true;
    return;
  }
  const manifest = latestManifest;
  const candidate = currentCandidate();
  const currentVideo = video;
  if (manifest === null || candidate === null || currentVideo === null) {
    overlay.setManifest(false);
    window.postMessage({source: 'openjoc-content', type: 'request-manifest'}, PAGE_ORIGIN);
    return;
  }
  isOpenJocRequested = true;
  latestStatus = null;
  lastStatusAt = performance.now();
  startHandshake = createStartHandshake();
  overlay.setStatus(null);
  overlay.setRequested(true);
  dispatchStartRequest();
}

function disableOpenJoc(reason: string): void {
  const wasRequested = isOpenJocRequested;
  if (wasRequested) traceLifecycle('disable', {reason});
  isOpenJocRequested = false;
  activeStartRequestId = null;
  pendingSeekRestart = false;
  startHandshake = createStartHandshake();
  restoreNativeAudio();
  overlay.setRequested(false);
  if (wasRequested) {
    videoGeneration += 1;
    const manifest = latestManifest;
    if (manifest !== null) send({target: 'background', type: 'disable', mediaKey: manifest.mediaKey, generation: videoGeneration});
  }
}

window.addEventListener('message', (event: MessageEvent<unknown>): void => {
  if (event.source !== window || event.origin !== PAGE_ORIGIN) return;
  const audio = record(event.data);
  if (audio?.source === 'openjoc-audio' && audio.type === 'audio-state') {
    const owner = nativeControl;
    if (!isOpenJocRequested || owner === null || owner.video !== video || owner.requestId !== activeStartRequestId
      || owner.generation !== videoGeneration || audio.token !== owner.token || audio.requestId !== owner.requestId || audio.generation !== owner.generation
      || !isFiniteNumber(audio.volume) || audio.volume < 0 || audio.volume > 1 || typeof audio.muted !== 'boolean') return;
    if (audio.suppressed !== true) {
      traceLifecycle('native-audio-control-unavailable');
      disableOpenJoc('native-audio-control-unavailable');
      return;
    }
    const activate = !owner.acknowledged;
    owner.acknowledged = true;
    send({target: 'background', type: 'player-volume', requestId: owner.requestId, generation: owner.generation,
      volume: audio.volume, muted: audio.muted, activate});
    return;
  }
  if (isPageRangeResponse(event.data)) {
    const pending = pendingPageRangeRequests.get(event.data.requestId);
    if (pending === undefined || pending.generation !== videoGeneration) return;
    pendingPageRangeRequests.delete(event.data.requestId);
    send({target: 'background', type: 'page-media-range-response', tabId: pending.tabId, generation: pending.generation, requestId: pending.requestId, status: event.data.status, contentRange: event.data.contentRange, error: event.data.error, bufferBase64: arrayBufferToBase64(event.data.buffer)});
    return;
  }
  if (isUnavailableMessage(event.data) && isCurrentPageMessage(event.data.pageUrl)) {
    disableOpenJoc('manifest-unavailable');
    latestManifest = null;
    overlay.setManifest(false);
    return;
  }
  if (!isManifestMessage(event.data)) return;
  if (!isCurrentPageMessage(event.data.pageUrl)) return;
  const current = latestManifest;
  if (current !== null && mediaKeyString(current.mediaKey) !== mediaKeyString(event.data.mediaKey)) {
    hasUnmutedPlayback = false;
    videoGeneration += 1;
    disableOpenJoc('media-changed');
    overlay.reset();
  }
  latestManifest = event.data;
  traceLifecycle('manifest', {candidateCount: event.data.candidates.length});
  send({target: 'background', type: 'manifest', pageUrl: location.href, mediaKey: event.data.mediaKey, candidates: event.data.candidates, generation: videoGeneration});
  const hasJocCandidate = currentCandidate() !== null;
  overlay.setManifest(hasJocCandidate);
  alwaysEnableAutoStartPending = alwaysEnableOpenJoc;
  maybeEnableAlways();
});

chrome.runtime.onMessage.addListener((message: unknown): void => {
  if (isStatusMessage(message)) applyStatus(message);
  if (isToggleMessage(message)) {
    if (isOpenJocRequested) {
      disableOpenJoc('toolbar-toggle');
    } else {
      overlay.toggleManually();
    }
  }
});

chrome.runtime.onMessage.addListener((message: unknown, sender: ChromeMessageSender): void => {
  if (!isRequestSessionMessage(message) || sender.id !== chrome.runtime.id || !isOpenJocRequested || latestManifest === null || video === null) return;
  if (message.requestId !== undefined && message.requestId !== activeStartRequestId) {
    traceLifecycle('session-recovery-stale', {recoveryRequestId: message.requestId});
    return;
  }
  const isForced = message.force === true;
  if (!shouldDispatchSessionRecovery(isForced, startHandshake)) {
    traceLifecycle('session-recovery-coalesced', {forced: isForced});
    return;
  }
  traceLifecycle('session-recovery', {forced: isForced, recoveryGeneration: message.generation ?? null});
  if (message.generation !== undefined) videoGeneration = Math.max(videoGeneration, message.generation + 1);
  latestStatus = null;
  if (startHandshake.acknowledged) startHandshake = createStartHandshake();
  dispatchStartRequest();
  lastSessionHeartbeatAt = performance.now();
});

chrome.runtime.onMessage.addListener((message: unknown, sender: ChromeMessageSender): void => {
  if (!isPageRangeRequest(message) || sender.id !== chrome.runtime.id || latestManifest === null || message.generation !== videoGeneration) return;
  const candidateUrls = latestManifest.candidates.flatMap((candidate) => [candidate.baseUrl, ...candidate.backupUrls]);
  if (!candidateUrls.includes(message.url)) return;
  pendingPageRangeRequests.set(message.requestId, message);
  window.postMessage({source: 'openjoc-content', type: 'fetch-media-range', requestId: message.requestId, url: message.url, start: message.start, end: message.end}, PAGE_ORIGIN);
});

document.addEventListener('visibilitychange', (): void => emitClock(true));

window.addEventListener('pageshow', (event: PageTransitionEvent): void => {
  if (!event.persisted) return;
  send({target: 'background', type: 'document-active'});
  traceLifecycle('document-restored');
  if (isOpenJocRequested) enableOpenJoc();
  else {
    alwaysEnableAutoStartPending = alwaysEnableOpenJoc;
    maybeEnableAlways();
  }
  window.postMessage({source: 'openjoc-content', type: 'request-manifest'}, PAGE_ORIGIN);
});

clockTimer = window.setInterval((): void => {
  const now = performance.now();
  const nextVideo = findMasterVideo();
  if (nextVideo !== null) attachVideo(nextVideo);
  if (location.href !== lastLocation) {
    lastLocation = location.href;
    if (isOpenJocRequested) {
      disableOpenJoc('location-changed');
    }
    hasUnmutedPlayback = false;
    latestManifest = null;
    videoGeneration += 1;
    overlay.reset();
    window.postMessage({source: 'openjoc-content', type: 'request-manifest'}, PAGE_ORIGIN);
  }
  advanceStartHandshake(now);
  if (nativeControl !== null && nativeControl.requestId === activeStartRequestId && nativeControl.generation === videoGeneration
    && !nativeControl.acknowledged && now - nativeControl.requestedAt > 2_000) {
    disableOpenJoc('native-audio-control-timeout');
  }
  const watchdogVideo = video;
  if (shouldExpirePlaybackStatus({
    requested: isOpenJocRequested,
    hasStatus: latestStatus !== null,
    isStreaming: latestStatus?.inbandJocConfirmed === true,
    documentVisible: document.visibilityState === 'visible',
    videoPaused: watchdogVideo?.paused ?? true,
    videoSeeking: watchdogVideo?.seeking ?? true,
    elapsedMs: now - lastStatusAt,
    timeoutMs: 4_000,
  })) {
    disableOpenJoc('status-timeout');
  }
  if (alwaysEnableAutoStartPending) maybeEnableAlways();
  emitClock();
}, CLOCK_INTERVAL_MS);
void clockTimer;
send({target: 'background', type: 'document-active'});
const initialVideo = findMasterVideo();
if (initialVideo !== null) attachVideo(initialVideo);
void restorePlaybackPreferences();
})();
