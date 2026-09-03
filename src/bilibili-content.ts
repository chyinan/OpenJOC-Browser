// pattern: Imperative Shell

(function (): void {

type ContentMediaKey = Readonly<{readonly bvid: string; readonly aid: string; readonly cid: string}>;
type ContentCandidate = Readonly<{readonly id: string; readonly source: 'dolby' | 'ec-3'; readonly codecs: string | null; readonly mimeType: string | null; readonly bandwidth: number | null; readonly baseUrl: string; readonly backupUrls: ReadonlyArray<string>}>;
type ContentManifest = Readonly<{readonly source: 'openjoc-bilibili'; readonly type: 'manifest'; readonly pageOrigin: string; readonly pageUrl: string; readonly mediaKey: ContentMediaKey; readonly candidates: ReadonlyArray<ContentCandidate>}>;
type ContentUnavailable = Readonly<{readonly source: 'openjoc-bilibili'; readonly type: 'unavailable'; readonly pageOrigin: string; readonly pageUrl: string; readonly reason: string}>;
type ContentStatus = Readonly<{readonly target: 'background'; readonly type: 'offscreen-status'; readonly tabId: number; readonly generation: number; readonly phase: 'disabled' | 'preparing' | 'ready' | 'active' | 'paused' | 'buffering' | 'error'; readonly reason: string | null; readonly inbandJocConfirmed: boolean; readonly profile: string | null; readonly metrics: Readonly<Record<string, unknown>>}>;
type ContentToggle = Readonly<{readonly target: 'background'; readonly type: 'toggle'}>;
type ContentRequestSession = Readonly<{readonly target: 'background'; readonly type: 'request-session'}>;
type ContentPageRangeRequest = Readonly<{readonly target: 'background'; readonly type: 'page-media-range-request'; readonly tabId: number; readonly generation: number; readonly requestId: string; readonly url: string; readonly start: number; readonly end: number}>;
type ContentPageRangeResponse = Readonly<{readonly source: 'openjoc-bilibili'; readonly type: 'media-range-response'; readonly pageOrigin: string; readonly pageUrl: string; readonly requestId: string; readonly status: number; readonly contentRange: string | null; readonly error: string | null; readonly buffer: ArrayBuffer}>;

const PAGE_ORIGIN = 'https://www.bilibili.com';
const MEDIA_SUFFIX = '.bilivideo.com';
const SAMPLE_RATE = 48_000;
const CLOCK_INTERVAL_MS = 100;
const SESSION_HEARTBEAT_INTERVAL_MS = 1_000;
let video: HTMLVideoElement | null = null;
let videoGeneration = 0;
let latestManifest: ContentManifest | null = null;
let nativeSnapshot: Readonly<{video: HTMLVideoElement; muted: boolean; volume: number; defaultMuted: boolean}> | null = null;
let isOpenJocRequested = false;
let latestStatus: ContentStatus | null = null;
let lastStatusAt = performance.now();
let lastSessionHeartbeatAt = 0;
let lastLocation = location.href;
let clockTimer: number | null = null;
let frameCallbackId: number | null = null;
const pendingPageRangeRequests = new Map<string, ContentPageRangeRequest>();

const panel = document.createElement('div');
const shadow = panel.attachShadow({mode: 'closed'});
const style = document.createElement('style');
style.textContent = ':host{all:initial} .panel{position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:8px;padding:10px 12px;width:230px;font:12px/1.4 sans-serif;box-shadow:0 4px 20px #0008}.row{display:flex;align-items:center;gap:8px;margin:4px 0}.button{flex:1;border:0;border-radius:5px;padding:6px 8px;background:#2563eb;color:white;cursor:pointer}.button:disabled{background:#4b5563;cursor:default}.select{background:#1f2937;color:#f9fafb;border:1px solid #4b5563;border-radius:4px;padding:3px}.status{color:#93c5fd}.details{white-space:pre-wrap;max-height:180px;overflow:auto;color:#d1d5db;margin-top:6px;font-size:10px}';
shadow.append(style);
const panelBody = document.createElement('div');
panelBody.className = 'panel';
panel.dataset.openjoc = 'control';
const title = document.createElement('div');
title.textContent = 'OpenJOC Browser';
const toggleButton = document.createElement('button');
toggleButton.className = 'button';
toggleButton.textContent = 'Enable OpenJOC';
const statusLabel = document.createElement('span');
statusLabel.className = 'status';
statusLabel.textContent = 'disabled';
const dialnormLabel = document.createElement('label');
dialnormLabel.textContent = 'Dialnorm';
const dialnormSelect = document.createElement('select');
dialnormSelect.className = 'select';
for (const option of [{value: 'calibrated', label: 'Calibrated'}, {value: 'unity', label: 'Unity'}]) {
  const element = document.createElement('option');
  element.value = option.value;
  element.textContent = option.label;
  dialnormSelect.append(element);
}
const details = document.createElement('div');
details.className = 'details';
panelBody.append(title, toggleButton, statusLabel, dialnormLabel, dialnormSelect, details);
shadow.append(panelBody);
document.documentElement.append(panel);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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

function isStatusMessage(value: unknown): value is ContentStatus {
  const candidate = record(value);
  return candidate !== null && candidate.target === 'background' && candidate.type === 'offscreen-status' && isFiniteNumber(candidate.tabId) && Number.isSafeInteger(candidate.tabId) && isFiniteNumber(candidate.generation) && Number.isSafeInteger(candidate.generation) && typeof candidate.phase === 'string' && (candidate.reason === null || isString(candidate.reason)) && typeof candidate.inbandJocConfirmed === 'boolean' && record(candidate.metrics) !== null;
}

function isToggleMessage(value: unknown): value is ContentToggle {
  const candidate = record(value);
  return candidate !== null && candidate.target === 'background' && candidate.type === 'toggle';
}

function isRequestSessionMessage(value: unknown): value is ContentRequestSession {
  const candidate = record(value);
  return candidate !== null && candidate.target === 'background' && candidate.type === 'request-session';
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

function send(message: unknown): void {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
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

function emitSessionHeartbeat(): void {
  const manifest = latestManifest;
  if (!isOpenJocRequested || manifest === null) return;
  const now = performance.now();
  if (now - lastSessionHeartbeatAt < SESSION_HEARTBEAT_INTERVAL_MS) return;
  lastSessionHeartbeatAt = now;
  send({target: 'background', type: 'session-heartbeat', pageUrl: location.href, mediaKey: manifest.mediaKey, generation: videoGeneration});
}

function emitClock(): void {
  emitSessionHeartbeat();
  const currentVideo = video;
  const manifest = latestManifest;
  if (currentVideo === null || manifest === null || !isOpenJocRequested) return;
  const currentTime = Number.isFinite(currentVideo.currentTime) ? Math.max(0, currentVideo.currentTime) : 0;
  send({target: 'background', type: 'video-clock', pageUrl: location.href, mediaKey: manifest.mediaKey, generation: videoGeneration, mediaTimeSamples: Math.round(currentTime * SAMPLE_RATE), paused: currentVideo.paused, buffering: currentVideo.readyState < 3, playbackRate: currentVideo.playbackRate, expectedDisplayTimeMs: null});
}

function scheduleVideoFrameCallback(): void {
  const currentVideo = video as (HTMLVideoElement & {requestVideoFrameCallback?: (callback: (now: number, metadata: Readonly<{mediaTime: number; expectedDisplayTime: number}>) => void) => number; cancelVideoFrameCallback?: (id: number) => void}) | null;
  if (currentVideo === null || currentVideo.requestVideoFrameCallback === undefined) return;
  frameCallbackId = currentVideo.requestVideoFrameCallback((_now, metadata): void => {
    if (video === currentVideo) {
      const manifest = latestManifest;
      if (manifest !== null && isOpenJocRequested) {
        send({target: 'background', type: 'video-clock', pageUrl: location.href, mediaKey: manifest.mediaKey, generation: videoGeneration, mediaTimeSamples: Math.max(0, Math.round(metadata.mediaTime * SAMPLE_RATE)), paused: currentVideo.paused, buffering: currentVideo.readyState < 3, playbackRate: currentVideo.playbackRate, expectedDisplayTimeMs: metadata.expectedDisplayTime});
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
    isOpenJocRequested = false;
    restoreNativeAudio();
    send({target: 'background', type: 'disable', generation: videoGeneration});
  }
  video = nextVideo;
  videoGeneration += 1;
  latestManifest = null;
  for (const eventName of ['play', 'pause', 'seeking', 'seeked', 'waiting', 'playing', 'canplay', 'stalled', 'timeupdate', 'ratechange', 'loadedmetadata', 'emptied', 'volumechange']) {
    nextVideo.addEventListener(eventName, (): void => {
      if (isOpenJocRequested && eventName === 'volumechange') nextVideo.muted = true;
      if (isOpenJocRequested && eventName === 'seeking') videoGeneration += 1;
      emitClock();
      updateDetails();
    });
  }
  scheduleVideoFrameCallback();
  window.postMessage({source: 'openjoc-content', type: 'request-manifest'}, PAGE_ORIGIN);
}

function restoreNativeAudio(): void {
  if (nativeSnapshot === null) return;
  const snapshot = nativeSnapshot;
  if (snapshot.video === video) {
    snapshot.video.muted = snapshot.muted;
    snapshot.video.volume = snapshot.volume;
    snapshot.video.defaultMuted = snapshot.defaultMuted;
  }
  nativeSnapshot = null;
}

function suppressNativeAudio(): void {
  const currentVideo = video;
  if (currentVideo === null) return;
  if (nativeSnapshot === null) {
    nativeSnapshot = {video: currentVideo, muted: currentVideo.muted, volume: currentVideo.volume, defaultMuted: currentVideo.defaultMuted};
  }
  currentVideo.muted = true;
  send({target: 'background', type: 'native-muted', generation: videoGeneration});
}

function updateDetails(): void {
  const metrics = latestStatus?.metrics;
  details.textContent = JSON.stringify({
    phase: latestStatus?.phase ?? 'disabled',
    stage: metrics?.stage ?? null,
    inbandJocConfirmed: latestStatus?.inbandJocConfirmed ?? false,
    profile: latestStatus?.profile ?? null,
    currentVideoMediaTime: metrics?.currentVideoMediaTime ?? null,
    currentAudioMediaTime: metrics?.currentAudioMediaTime ?? null,
    driftMs: metrics?.driftMs ?? null,
    pcmBufferMs: metrics?.pcmBufferMs ?? 0,
    decodedAccessUnits: metrics?.decodedAccessUnits ?? 0,
    outputFrames: metrics?.outputFrames ?? 0,
    outputSamples: metrics?.outputSamples ?? 0,
    underruns: metrics?.underrunCount ?? 0,
    media: metrics?.mediaUrl ?? null,
  }, null, 2);
}

function applyStatus(status: ContentStatus): void {
  if (status.generation < videoGeneration) return;
  latestStatus = status;
  if (status.generation > videoGeneration) videoGeneration = status.generation;
  lastStatusAt = performance.now();
  statusLabel.textContent = status.phase + (status.reason === null ? '' : `: ${status.reason}`);
  toggleButton.textContent = status.phase === 'disabled' || status.phase === 'error' ? 'Enable OpenJOC' : 'Disable OpenJOC';
  if (status.phase === 'ready' && status.inbandJocConfirmed) suppressNativeAudio();
  if (status.phase === 'disabled' || status.phase === 'error') {
    isOpenJocRequested = false;
    restoreNativeAudio();
  }
  updateDetails();
}

function enableOpenJoc(): void {
  const manifest = latestManifest;
  const candidate = currentCandidate();
  const currentVideo = video;
  if (manifest === null || candidate === null || currentVideo === null) {
    statusLabel.textContent = 'JOC stream unavailable';
    window.postMessage({source: 'openjoc-content', type: 'request-manifest'}, PAGE_ORIGIN);
    return;
  }
  isOpenJocRequested = true;
  latestStatus = null;
  statusLabel.textContent = 'preparing';
  send({target: 'background', type: 'start', pageUrl: location.href, mediaKey: manifest.mediaKey, candidates: manifest.candidates, generation: videoGeneration, videoTimeSamples: Math.max(0, Math.round(currentVideo.currentTime * SAMPLE_RATE)), dialnorm: dialnormSelect.value === 'unity' ? 'unity' : 'calibrated'});
  emitClock();
  updateDetails();
}

toggleButton.addEventListener('click', (): void => {
  if (isOpenJocRequested) {
    isOpenJocRequested = false;
    restoreNativeAudio();
    send({target: 'background', type: 'disable', generation: videoGeneration});
    statusLabel.textContent = 'disabled';
    updateDetails();
    return;
  }
  enableOpenJoc();
});

dialnormSelect.addEventListener('change', (): void => {
  send({target: 'background', type: 'dialnorm', generation: videoGeneration, mode: dialnormSelect.value === 'unity' ? 'unity' : 'calibrated'});
});

window.addEventListener('message', (event: MessageEvent<unknown>): void => {
  if (event.source !== window || event.origin !== PAGE_ORIGIN) return;
  if (isPageRangeResponse(event.data)) {
    const pending = pendingPageRangeRequests.get(event.data.requestId);
    if (pending === undefined || pending.generation !== videoGeneration) return;
    pendingPageRangeRequests.delete(event.data.requestId);
    send({target: 'background', type: 'page-media-range-response', tabId: pending.tabId, generation: pending.generation, requestId: pending.requestId, status: event.data.status, contentRange: event.data.contentRange, error: event.data.error, bufferBase64: arrayBufferToBase64(event.data.buffer)});
    return;
  }
  if (isUnavailableMessage(event.data)) {
    statusLabel.textContent = `JOC stream unavailable: ${event.data.reason}`;
    if (isOpenJocRequested) {
      isOpenJocRequested = false;
      restoreNativeAudio();
      send({target: 'background', type: 'disable', generation: videoGeneration});
    }
    return;
  }
  if (!isManifestMessage(event.data)) return;
  const current = latestManifest;
  if (current !== null && mediaKeyString(current.mediaKey) !== mediaKeyString(event.data.mediaKey)) {
    videoGeneration += 1;
    isOpenJocRequested = false;
    restoreNativeAudio();
    send({target: 'background', type: 'disable', generation: videoGeneration});
  }
  latestManifest = event.data;
  updateDetails();
});

chrome.runtime.onMessage.addListener((message: unknown): void => {
  if (isStatusMessage(message)) applyStatus(message);
  if (isToggleMessage(message)) {
    if (isOpenJocRequested) {
      isOpenJocRequested = false;
      restoreNativeAudio();
      send({target: 'background', type: 'disable', generation: videoGeneration});
      statusLabel.textContent = 'disabled';
      updateDetails();
    } else {
      enableOpenJoc();
    }
  }
});

chrome.runtime.onMessage.addListener((message: unknown, sender: ChromeMessageSender): void => {
  if (!isRequestSessionMessage(message) || sender.id !== chrome.runtime.id || !isOpenJocRequested || latestManifest === null || video === null) return;
  const currentTime = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;
  send({target: 'background', type: 'start', pageUrl: location.href, mediaKey: latestManifest.mediaKey, candidates: latestManifest.candidates, generation: videoGeneration, videoTimeSamples: Math.round(currentTime * SAMPLE_RATE), dialnorm: dialnormSelect.value === 'unity' ? 'unity' : 'calibrated'});
  lastSessionHeartbeatAt = performance.now();
});

chrome.runtime.onMessage.addListener((message: unknown, sender: ChromeMessageSender): void => {
  if (!isPageRangeRequest(message) || sender.id !== chrome.runtime.id || latestManifest === null || message.generation !== videoGeneration) return;
  const candidateUrls = latestManifest.candidates.flatMap((candidate) => [candidate.baseUrl, ...candidate.backupUrls]);
  if (!candidateUrls.includes(message.url)) return;
  pendingPageRangeRequests.set(message.requestId, message);
  window.postMessage({source: 'openjoc-content', type: 'fetch-media-range', requestId: message.requestId, url: message.url, start: message.start, end: message.end}, PAGE_ORIGIN);
});

clockTimer = window.setInterval((): void => {
  const nextVideo = findMasterVideo();
  if (nextVideo !== null) attachVideo(nextVideo);
  if (location.href !== lastLocation) {
    lastLocation = location.href;
    if (isOpenJocRequested) {
      isOpenJocRequested = false;
      restoreNativeAudio();
      send({target: 'background', type: 'disable', generation: videoGeneration});
    }
    latestManifest = null;
    videoGeneration += 1;
    window.postMessage({source: 'openjoc-content', type: 'request-manifest'}, PAGE_ORIGIN);
  }
  if (isOpenJocRequested && latestStatus !== null && latestStatus.phase !== 'disabled' && latestStatus.phase !== 'error' && performance.now() - lastStatusAt > 4_000) {
    isOpenJocRequested = false;
    restoreNativeAudio();
    statusLabel.textContent = 'OpenJOC extension heartbeat lost';
    send({target: 'background', type: 'disable', generation: videoGeneration});
  }
  emitClock();
  updateDetails();
}, CLOCK_INTERVAL_MS);
void clockTimer;
const initialVideo = findMasterVideo();
if (initialVideo !== null) attachVideo(initialVideo);
})();
