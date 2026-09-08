// pattern: Imperative Shell

import {fetchCmafIndex, fetchCmafSegment, type CmafIndexSession} from './cmaf-fetcher.js';
import {parseCmafFragment, type CmafSample, type CmafSegmentReference} from './cmaf-transport.js';
import {selectCmafSegmentWindow} from './cmaf-window.js';
import {isRuntimeMessage, type MediaKey, type PlaybackMetrics, type RuntimeMessage} from './extension-protocol.js';
import {sanitizeMediaUrl} from './media-url-policy.js';
import {createDriftMetrics, recordDriftSample, resumeAudioPhase, shouldResyncForAudioLead, type DriftMetrics} from './sync-state.js';
import {advanceDecoderProgressWatchdog, createDecoderProgressWatchdog, hasDecoderMadeProgress, type DecoderProgressWatchdog} from './decode-progress.js';
import {estimateMediaTimeSamples} from './video-clock-estimate.js';
import {type DecoderWorkerStatus, type WorkerCommand, type WorkerMessage} from './worker-protocol.js';
import {sessionTargetMatches, type MediaSessionTarget} from './media-session-policy.js';
import {gainDbToAmplitude} from './output-gain.js';

const SAMPLE_RATE = 48_000;
const MAX_SEGMENTS_PER_WINDOW = 2;
const PUMP_THRESHOLD_SAMPLES = SAMPLE_RATE * 4;
const PREFETCH_INTERVAL_MS = 250;
const VIDEO_CLOCK_STALE_AFTER_MS = 350;
const PREPARATION_TIMEOUT_MS = 30_000;
const DECODER_PROGRESS_TIMEOUT_MS = 10_000;

type SessionStage = 'starting-audio' | 'starting-decoder' | 'fetching-index' | 'fetching-page-context-index' | 'fetching-segment' | 'decoding' | 'waiting-for-joc-profile' | 'streaming';

type WorkletStats = Readonly<{
  readonly queuedAudioMs: number;
  readonly averageDb: number | null;
  readonly underrunCount: number;
  readonly acceptedSequence: number;
  readonly currentAudioMediaSamples: number | null;
  readonly driftMs: number | null;
  readonly resyncCount: number;
  readonly processGapMaxMs: number;
  readonly processGapOver20MsCount: number;
  readonly playedQuantumCount: number;
  readonly silentQuantumCount: number;
  readonly lastTimestampedReadType: string | null;
}>;

type OutputClock = Readonly<{
  readonly contextTime: number | null;
  readonly performanceTime: number | null;
  readonly baseLatencyMs: number | null;
  readonly outputLatencyMs: number | null;
}>;

type Session = {
  readonly request: Extract<RuntimeMessage, {target: 'offscreen'; type: 'start'}>;
  readonly audioGeneration: number;
  readonly abort: AbortController;
  gainDb: number;
  playerVolume: number;
  playerMuted: boolean;
  index: CmafIndexSession | null;
  nextReferenceIndex: number;
  windowEndSamples: number;
  isStreaming: boolean;
  isNativeMuted: boolean;
  isJocConfirmed: boolean;
  isPaused: boolean;
  isBuffering: boolean;
  phase: 'preparing' | 'ready' | 'active' | 'paused' | 'buffering';
  stage: SessionStage;
  preparationTimer: number | null;
};

type StartRequest = Extract<RuntimeMessage, {target: 'offscreen'; type: 'start'}>;
type PendingStart = {readonly token: number; readonly request: StartRequest; gainDb: number};

type PendingProgress = {
  readonly session: Session;
  readonly previousAccessUnits: number;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  timeoutId: number | null;
  watchdog: DecoderProgressWatchdog;
};

let worker: Worker | null = null;
// Page generations restart on navigation; the persistent audio graph must never roll back.
let lastAudioGeneration = 0;
let audioContext: AudioContext | null = null;
let audioNode: AudioWorkletNode | null = null;
let silentKeepAlive: ConstantSourceNode | null = null;
let currentSession: Session | null = null;
let latestDecoderStatus: DecoderWorkerStatus | null = null;
let latestWorkletStats: WorkletStats = {
  queuedAudioMs: 0,
  averageDb: null,
  underrunCount: 0,
  acceptedSequence: 0,
  currentAudioMediaSamples: null,
  driftMs: null,
  resyncCount: 0,
  processGapMaxMs: 0,
  processGapOver20MsCount: 0,
  playedQuantumCount: 0,
  silentQuantumCount: 0,
  lastTimestampedReadType: null,
};
let latestVideoMediaSamples: number | null = null;
let lastVideoClockAtMs = 0;
let lastVideoPlaybackRate = 1;
let driftMetrics: DriftMetrics = createDriftMetrics();
let outputClock: OutputClock = {contextTime: null, performanceTime: null, baseLatencyMs: null, outputLatencyMs: null};
let pendingProgress: Array<PendingProgress> = [];
let pageRangeRequestSequence = 0;
let latestStartToken = 0;
let startOperationTail: Promise<void> = Promise.resolve();
let pendingStart: PendingStart | null = null;
const pendingPageRanges = new Map<string, Readonly<{generation: number; resolve(response: PageRangeResponse): void; reject(error: Error): void}>>();

type PageRangeResponse = Readonly<{readonly status: number; readonly contentRange: string | null; readonly error: string | null; readonly buffer: ArrayBuffer}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function isWorkletStats(value: unknown): value is WorkletStats & {readonly type: 'stats'; readonly generation: number} {
  return isRecord(value) && value.type === 'stats' && typeof value.generation === 'number' && typeof value.queuedAudioMs === 'number' && (value.averageDb === null || (typeof value.averageDb === 'number' && Number.isFinite(value.averageDb))) && typeof value.underrunCount === 'number' && typeof value.acceptedSequence === 'number' && (value.currentAudioMediaSamples === null || typeof value.currentAudioMediaSamples === 'number') && (value.driftMs === null || typeof value.driftMs === 'number') && typeof value.resyncCount === 'number' && typeof value.processGapMaxMs === 'number' && typeof value.processGapOver20MsCount === 'number' && typeof value.playedQuantumCount === 'number' && typeof value.silentQuantumCount === 'number' && (value.lastTimestampedReadType === null || typeof value.lastTimestampedReadType === 'string');
}

function isCurrentSession(session: Session): boolean {
  return currentSession === session && !session.abort.signal.aborted;
}

function sendStatus(
  phase: Session['phase'] | 'error' | 'disabled',
  reason: string | null,
  session: Session | null,
): void {
  if (session === null) return;
  outputClock = readOutputClock();
  const decoder = latestDecoderStatus;
  const currentVideo = latestVideoMediaSamples ?? session.request.videoTimeSamples;
  const currentAudio = latestWorkletStats.currentAudioMediaSamples;
  const metrics: PlaybackMetrics = {
    stage: session.stage,
    renderer: decoder?.renderer ?? session.request.renderer,
    virtualLayout: decoder?.virtualLayout ?? (session.request.renderer === 'binaural' ? '7.1.4' : null),
    hrtf: decoder?.hrtf ?? (session.request.renderer === 'binaural' ? 'Built-in SADIE II D1' : null),
    binauralLatencyMs: decoder?.renderer === 'binaural' ? decoder.latencySamples * 1000 / SAMPLE_RATE : null,
    binauralP95Ms: decoder?.renderer === 'binaural' ? decoder.binauralP95Ms : null,
    binauralMaxMs: decoder?.renderer === 'binaural' ? decoder.binauralMaxMs : null,
    currentVideoMediaTime: currentVideo / SAMPLE_RATE,
    currentAudioMediaTime: currentAudio === null ? null : currentAudio / SAMPLE_RATE,
    driftMs: latestWorkletStats.driftMs,
    driftP50Ms: driftMetrics.p50Ms,
    driftP95Ms: driftMetrics.p95Ms,
    driftMaxMs: driftMetrics.maxMs,
    resyncCount: latestWorkletStats.resyncCount,
    compressedBufferMs: Math.max(0, (session.windowEndSamples - currentVideo) * 1000 / SAMPLE_RATE),
    pcmBufferMs: latestWorkletStats.queuedAudioMs,
    averageDb: latestWorkletStats.averageDb,
    underrunCount: latestWorkletStats.underrunCount,
    decodeMeanMs: decoder?.decodeMeanMs ?? 0,
    decodeP95Ms: decoder?.decodeP95Ms ?? 0,
    decodeMaxMs: decoder?.decodeMaxMs ?? 0,
    realtimeFactor: decoder?.realtimeFactor ?? null,
    peakWasmMemoryBytes: decoder?.wasmMemoryPeakBytes ?? 0,
    mediaUrl: session.request.candidate.baseUrl.length > 0 ? sanitizeMediaUrl(session.request.candidate.baseUrl) : null,
    audioContextTime: outputClock.contextTime,
    audioPerformanceTime: outputClock.performanceTime,
    baseLatencyMs: outputClock.baseLatencyMs,
    outputLatencyMs: outputClock.outputLatencyMs,
    decodedAccessUnits: decoder?.decodedAccessUnits ?? 0,
    outputFrames: decoder?.outputFrames ?? 0,
    outputSamples: decoder?.outputSamples ?? 0,
    workletProcessGapMaxMs: latestWorkletStats.processGapMaxMs,
    workletProcessGapOver20MsCount: latestWorkletStats.processGapOver20MsCount,
    workletPlayedQuantumCount: latestWorkletStats.playedQuantumCount,
    workletSilentQuantumCount: latestWorkletStats.silentQuantumCount,
    workletLastReadType: latestWorkletStats.lastTimestampedReadType,
  };
  const message: RuntimeMessage = {target: 'background', type: 'offscreen-status', requestId: session.request.requestId, tabId: session.request.tabId, mediaKey: session.request.mediaKey, generation: session.request.generation, phase, reason, inbandJocConfirmed: session.isJocConfirmed, profile: decoder?.profile ?? null, metrics};
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

function readOutputClock(): OutputClock {
  if (audioContext === null) return {contextTime: null, performanceTime: null, baseLatencyMs: null, outputLatencyMs: null};
  const timestamp = audioContext.getOutputTimestamp();
  return {
    contextTime: typeof timestamp.contextTime === 'number' && Number.isFinite(timestamp.contextTime) ? timestamp.contextTime : null,
    performanceTime: typeof timestamp.performanceTime === 'number' && Number.isFinite(timestamp.performanceTime) ? timestamp.performanceTime : null,
    baseLatencyMs: Number.isFinite(audioContext.baseLatency) ? audioContext.baseLatency * 1000 : null,
    outputLatencyMs: Number.isFinite(audioContext.outputLatency) ? audioContext.outputLatency * 1000 : null,
  };
}

async function ensureAudio(): Promise<AudioContext> {
  if (audioContext !== null && audioNode !== null) return audioContext;
  const nextContext = new AudioContext({sampleRate: SAMPLE_RATE, latencyHint: 'playback'});
  try {
    if (nextContext.sampleRate !== SAMPLE_RATE) throw new Error(`AudioContext negotiated ${nextContext.sampleRate} Hz, expected 48000 Hz`);
    await nextContext.audioWorklet.addModule(new URL('./pcm-processor.js', import.meta.url));
    const nextNode = new AudioWorkletNode(nextContext, 'openjoc-pcm', {numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2]});
    nextNode.port.onmessage = (event: MessageEvent<unknown>): void => {
      if (isWorkletStats(event.data) && currentSession !== null && event.data.generation === currentSession.audioGeneration) {
        latestWorkletStats = event.data;
        worker?.postMessage({type: 'queue-stats', generation: event.data.generation, queuedAudioMs: event.data.queuedAudioMs, acceptedSequence: event.data.acceptedSequence} satisfies WorkerCommand);
        if (event.data.driftMs !== null) driftMetrics = recordDriftSample(driftMetrics, event.data.driftMs);
        sendStatus(currentSession.phase, null, currentSession);
      } else if (isRecord(event.data) && event.data.type === 'error' && typeof event.data.message === 'string') {
        void failSession(event.data.message);
      }
    };
    nextNode.connect(nextContext.destination);
    const silentGain = nextContext.createGain();
    silentGain.gain.value = 0;
    const silentSource = nextContext.createConstantSource();
    silentSource.offset.value = 0;
    silentSource.connect(silentGain).connect(nextContext.destination);
    silentSource.start();
    audioContext = nextContext;
    audioNode = nextNode;
    silentKeepAlive = silentSource;
    return nextContext;
  } catch (error: unknown) {
    await nextContext.close();
    throw error;
  }
}

function ensureWorker(): Worker {
  if (worker === null) {
    worker = new Worker(new URL('./decoder-worker.js', import.meta.url), {type: 'module'});
    worker.onmessage = (event: MessageEvent<WorkerMessage>): void => handleWorkerMessage(event.data);
    worker.onerror = (event: ErrorEvent): void => {
      void failSession(event.message || 'OpenJOC decoder worker failed');
    };
  }
  return worker;
}

function resetAudio(generation: number): void {
  worker?.postMessage({type: 'reset', generation} satisfies WorkerCommand);
  audioNode?.port.postMessage({type: 'reset', generation});
  latestDecoderStatus = null;
  driftMetrics = createDriftMetrics();
  latestWorkletStats = {queuedAudioMs: 0, averageDb: null, underrunCount: 0, acceptedSequence: 0, currentAudioMediaSamples: null, driftMs: null, resyncCount: 0, processGapMaxMs: 0, processGapOver20MsCount: 0, playedQuantumCount: 0, silentQuantumCount: 0, lastTimestampedReadType: null};
  pendingProgress.forEach((pending) => pending.reject(new Error('OpenJOC playback generation reset')));
  pendingProgress = [];
}

function applyOutputGain(session: Session, immediate = false): void {
  if (!isCurrentSession(session) || audioNode === null || audioContext === null) return;
  const gain = audioNode.parameters.get('outputGain');
  if (gain === undefined) throw new Error('OpenJOC output gain parameter is unavailable');
  const now = audioContext.currentTime;
  const amplitude = session.playerMuted ? 0 : session.playerVolume * gainDbToAmplitude(session.gainDb);
  gain.cancelAndHoldAtTime(now);
  if (immediate) gain.setValueAtTime(amplitude, now);
  else gain.setTargetAtTime(amplitude, now, 0.015);
}

function isProgressWatchdogPaused(session: Session): boolean {
  return session.isPaused || session.isBuffering;
}

function scheduleDecoderProgressTimeout(pending: PendingProgress): void {
  if (pending.timeoutId !== null || isProgressWatchdogPaused(pending.session)) return;
  pending.timeoutId = window.setTimeout((): void => {
    pending.timeoutId = null;
    if (!pendingProgress.includes(pending)) return;
    const update = advanceDecoderProgressWatchdog({watchdog: pending.watchdog, nowMs: performance.now(), isPaused: isProgressWatchdogPaused(pending.session)});
    pending.watchdog = update.state;
    if (update.expired) {
      pendingProgress = pendingProgress.filter((entry) => entry !== pending);
      pending.reject(new Error('OpenJOC decoder made no progress while decoding CMAF audio'));
      return;
    }
    scheduleDecoderProgressTimeout(pending);
  }, Math.max(1, Math.ceil(pending.watchdog.remainingMs)));
}

function updateDecoderProgressWatchdogs(session: Session): void {
  const isPaused = isProgressWatchdogPaused(session);
  const nowMs = performance.now();
  for (const pending of pendingProgress) {
    if (pending.session !== session) continue;
    const update = advanceDecoderProgressWatchdog({watchdog: pending.watchdog, nowMs, isPaused});
    pending.watchdog = update.state;
    if (pending.timeoutId !== null) {
      window.clearTimeout(pending.timeoutId);
      pending.timeoutId = null;
    }
    if (update.expired) {
      pendingProgress = pendingProgress.filter((entry) => entry !== pending);
      pending.reject(new Error('OpenJOC decoder made no progress while decoding CMAF audio'));
    } else if (!isPaused) {
      scheduleDecoderProgressTimeout(pending);
    }
  }
}

function waitForDecoderProgress(session: Session, previousAccessUnits: number): Promise<void> {
  if (latestDecoderStatus !== null && hasDecoderMadeProgress(previousAccessUnits, latestDecoderStatus.decodedAccessUnits)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      if (pending.timeoutId !== null) window.clearTimeout(pending.timeoutId);
      callback();
    };
    const pending: PendingProgress = {
      session,
      previousAccessUnits,
      resolve: () => finish(resolve),
      reject: (error: Error) => finish(() => reject(error)),
      timeoutId: null,
      watchdog: createDecoderProgressWatchdog({timeoutMs: DECODER_PROGRESS_TIMEOUT_MS, nowMs: performance.now(), isPaused: isProgressWatchdogPaused(session)}),
    };
    pendingProgress.push(pending);
    scheduleDecoderProgressTimeout(pending);
  });
}

function resolveDecoderProgress(status: DecoderWorkerStatus): void {
  const ready = pendingProgress.filter((pending) => pending.session === currentSession && hasDecoderMadeProgress(pending.previousAccessUnits, status.decodedAccessUnits));
  pendingProgress = pendingProgress.filter((pending) => !ready.includes(pending));
  ready.forEach((pending) => pending.resolve());
}

function handleWorkerMessage(message: WorkerMessage): void {
  const session = currentSession;
  if (session === null || message.generation !== session.audioGeneration) return;
  if (message.type === 'pcm') {
    if (audioNode === null || message.ptsSamples === null) {
      void failSession('OpenJOC did not return a timestamped CMAF PCM block');
      return;
    }
    audioNode.port.postMessage({type: 'pcm', generation: message.generation, sequence: message.sequence, buffer: message.buffer, ptsSamples: message.ptsSamples}, [message.buffer]);
    return;
  }
  if (message.type === 'decoder-status') {
    latestDecoderStatus = message.status;
    resolveDecoderProgress(message.status);
    if (message.status.profile !== null && message.status.profile.length > 0) {
      session.isJocConfirmed = true;
      session.stage = 'streaming';
      if (session.preparationTimer !== null) {
        window.clearTimeout(session.preparationTimer);
        session.preparationTimer = null;
      }
      if (!session.isNativeMuted && (session.phase === 'preparing' || session.phase === 'paused' || session.phase === 'buffering')) {
        session.phase = 'ready';
        sendStatus('ready', null, session);
      }
    }
    sendStatus(session.phase, null, session);
    return;
  }
  if (message.type === 'decode-complete') {
    sendStatus(session.isNativeMuted ? 'active' : session.phase, null, session);
    return;
  }
  void failSession(message.message);
}

async function pumpSegments(session: Session): Promise<void> {
  if (!isCurrentSession(session) || session.index === null || session.isStreaming) return;
  const references = session.index.index.references.slice(session.nextReferenceIndex, session.nextReferenceIndex + MAX_SEGMENTS_PER_WINDOW);
  if (references.length === 0) {
    ensureWorker().postMessage({type: 'end-cmaf', generation: session.audioGeneration} satisfies WorkerCommand);
    return;
  }
  const decoderWorker = ensureWorker();
  session.isStreaming = true;
  try {
    let firstSample = (latestDecoderStatus?.decodedAccessUnits ?? 0) === 0;
    for (const reference of references) {
      if (!isCurrentSession(session)) return;
      session.stage = 'fetching-segment';
      const samples = await fetchSegmentWithPageFallback(session.index, reference, session.abort.signal, session.request.tabId, session.request.generation);
      const previousAccessUnits = latestDecoderStatus?.decodedAccessUnits ?? 0;
      for (const sample of samples) {
        if (!isCurrentSession(session)) return;
        session.stage = 'decoding';
        const buffer = sample.bytes.slice().buffer;
        decoderWorker.postMessage({type: 'decode-cmaf-sample', generation: session.audioGeneration, bytes: buffer, ptsSamples: sample.ptsSamples, discontinuity: firstSample, preroll: firstSample, dialnorm: session.request.dialnorm, renderer: session.request.renderer} satisfies WorkerCommand, [buffer]);
        firstSample = false;
      }
      await waitForDecoderProgress(session, previousAccessUnits);
      session.nextReferenceIndex += 1;
      session.windowEndSamples = Math.max(session.windowEndSamples, reference.ptsSamples + reference.durationSamples);
    }
    session.stage = 'waiting-for-joc-profile';
    if ((latestDecoderStatus?.decodedAccessUnits ?? 0) === 0) {
      throw new Error('OpenJOC did not decode any CMAF audio access units');
    }
    if (latestDecoderStatus === null || latestDecoderStatus.profile === null || latestDecoderStatus.profile.length === 0) {
      throw new Error('decoded CMAF audio did not report an in-band JOC profile');
    }
  } catch (error: unknown) {
    if (!session.abort.signal.aborted) await failSession(error instanceof Error ? error.message : 'failed to fetch Bilibili CMAF media');
  } finally {
    session.isStreaming = false;
  }
}

function pumpFromEstimatedVideoClock(): void {
  const session = currentSession;
  const currentVideo = latestVideoMediaSamples;
  if (session === null || currentVideo === null || session.isPaused || session.isBuffering) return;
  if (session.isNativeMuted && audioContext !== null && audioContext.state !== 'running') void audioContext.resume();
  const elapsedMs = performance.now() - lastVideoClockAtMs;
  const estimatedVideo = estimateMediaTimeSamples(currentVideo, elapsedMs, lastVideoPlaybackRate);
  if (elapsedMs >= VIDEO_CLOCK_STALE_AFTER_MS) {
    audioNode?.port.postMessage({type: 'clock', generation: session.audioGeneration, mediaTimeSamples: estimatedVideo, paused: false, buffering: false});
  }
  if (session.index === null || session.isStreaming || session.nextReferenceIndex >= session.index.index.references.length) return;
  if (estimatedVideo + PUMP_THRESHOLD_SAMPLES >= session.windowEndSamples) void pumpSegments(session);
}

async function fetchIndexWithFallback(
  request: Extract<RuntimeMessage, {target: 'offscreen'; type: 'start'}>,
  signal: AbortSignal,
  updateStage: (stage: SessionStage) => void,
): Promise<CmafIndexSession> {
  const urls = [request.candidate.baseUrl, ...request.candidate.backupUrls];
  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      updateStage('fetching-index');
      return await fetchCmafIndex({url, pageUrl: request.pageUrl, signal});
    } catch (error: unknown) {
      if (signal.aborted) throw error;
      if (error instanceof Error && (error.message.includes('status 403') || error.message.includes('request timed out'))) {
        try {
          updateStage('fetching-page-context-index');
          const pageResponse = await requestPageRange(request.tabId, request.generation, url, 0, 8_191, signal);
          if (pageResponse.status !== 206) throw new Error(`page-context CMAF range request returned status ${pageResponse.status}`);
          return await fetchCmafIndex({
            url,
            pageUrl: request.pageUrl,
            signal,
            fetchImpl: async (): Promise<Response> => new Response(pageResponse.buffer, {status: pageResponse.status, headers: pageResponse.contentRange === null ? undefined : {'content-range': pageResponse.contentRange}}),
          });
        } catch (pageError: unknown) {
          if (signal.aborted) throw pageError;
          lastError = pageError instanceof Error ? pageError : new Error('page-context CMAF range fetch failed');
          continue;
        }
      }
      lastError = error instanceof Error ? error : new Error('failed to fetch Bilibili CMAF initialization');
    }
  }
  throw lastError ?? new Error('Bilibili JOC stream unavailable');
}

async function requestPageRange(tabId: number, generation: number, url: string, start: number, end: number, signal: AbortSignal): Promise<PageRangeResponse> {
  const requestId = `page-range-${tabId}-${generation}-${pageRangeRequestSequence}`;
  pageRangeRequestSequence += 1;
  const responsePromise = new Promise<PageRangeResponse>((resolve, reject) => {
    pendingPageRanges.set(requestId, {generation, resolve, reject});
  });
  const timeoutId = window.setTimeout((): void => {
    const pending = pendingPageRanges.get(requestId);
    pendingPageRanges.delete(requestId);
    pending?.reject(new Error('page-context media range request timed out'));
  }, 10_000);
  const message: RuntimeMessage = {target: 'background', type: 'page-media-range-request', tabId, generation, requestId, url, start, end};
  chrome.runtime.sendMessage(message).catch((error: unknown) => {
    const pending = pendingPageRanges.get(requestId);
    pendingPageRanges.delete(requestId);
    pending?.reject(error instanceof Error ? error : new Error('failed to request page-context media range'));
  });
  const abort = (): void => {
    const pending = pendingPageRanges.get(requestId);
    pendingPageRanges.delete(requestId);
    pending?.reject(new Error('page-context media range request aborted'));
  };
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, {once: true});
  try {
    const response = await responsePromise;
    validatePageRangeResponse(response, start, end);
    return response;
  } finally {
    window.clearTimeout(timeoutId);
    signal.removeEventListener('abort', abort);
    pendingPageRanges.delete(requestId);
  }
}

function validatePageRangeResponse(response: PageRangeResponse, start: number, end: number): void {
  if (response.buffer.byteLength > end - start + 1) throw new Error('page-context CMAF range exceeded the requested bound');
  if (response.status !== 206 || response.contentRange === null) return;
  const match = /^bytes (\d+)-(\d+)\/\d+$/.exec(response.contentRange);
  if (match === null || Number(match[1]) !== start || Number(match[2]) < start || Number(match[2]) > end || response.buffer.byteLength !== Number(match[2]) - start + 1) {
    throw new Error('page-context CMAF Content-Range is invalid');
  }
}

async function startSession(request: StartRequest, token: number): Promise<void> {
  await stopSession(currentSession !== null && currentSession.request.tabId !== request.tabId);
  if (token !== latestStartToken || pendingStart?.token !== token) return;
  const session: Session = {request, audioGeneration: ++lastAudioGeneration, abort: new AbortController(), gainDb: pendingStart.gainDb, playerVolume: 1, playerMuted: false, index: null, nextReferenceIndex: 0, windowEndSamples: request.videoTimeSamples, isStreaming: false, isNativeMuted: false, isJocConfirmed: false, isPaused: request.paused, isBuffering: request.buffering, phase: request.buffering ? 'buffering' : request.paused ? 'paused' : 'preparing', stage: 'starting-audio', preparationTimer: null};
  currentSession = session;
  session.preparationTimer = window.setTimeout((): void => {
    if (isCurrentSession(session) && !session.isJocConfirmed) void failSession(`OpenJOC ${session.stage} timed out before JOC PCM became available`);
  }, PREPARATION_TIMEOUT_MS);
  latestVideoMediaSamples = request.videoTimeSamples;
  lastVideoClockAtMs = performance.now();
  lastVideoPlaybackRate = 1;
  const context = await ensureAudio();
  if (!isCurrentSession(session)) return;
  session.stage = 'starting-decoder';
  ensureWorker();
  resetAudio(session.audioGeneration);
  audioNode?.port.postMessage({type: 'clock', generation: session.audioGeneration, mediaTimeSamples: request.videoTimeSamples, paused: session.isPaused, buffering: session.isBuffering});
  applyOutputGain(session, true);
  await context.resume();
  sendStatus('preparing', null, session);
  try {
    session.stage = 'fetching-index';
    session.index = await fetchIndexWithFallback(request, session.abort.signal, (stage): void => {
      if (isCurrentSession(session)) session.stage = stage;
    });
    if (!isCurrentSession(session)) return;
    const references = selectCmafSegmentWindow(session.index.index, request.videoTimeSamples, MAX_SEGMENTS_PER_WINDOW);
    if (references.length === 0) throw new Error('Bilibili JOC stream has no segment at the current video time');
    const firstReference = references[0];
    if (firstReference === undefined) throw new Error('Bilibili JOC stream has no segment at the current video time');
    session.nextReferenceIndex = session.index.index.references.indexOf(firstReference);
    session.windowEndSamples = references[references.length - 1]?.ptsSamples ?? request.videoTimeSamples;
    void pumpSegments(session);
  } catch (error: unknown) {
    if (!session.abort.signal.aborted) await failSession(error instanceof Error ? error.message : 'failed to prepare Bilibili CMAF media');
  }
}

function enqueueStartSession(request: StartRequest): void {
  const token = latestStartToken + 1;
  latestStartToken = token;
  pendingStart = {token, request, gainDb: request.gainDb ?? 0};
  // Release an obsolete startup's fetch before waiting for its serialized cleanup.
  // A seek changes the page generation, so the old page-context range can no longer reply.
  currentSession?.abort.abort();
  startOperationTail = startOperationTail
    .catch(() => undefined)
    .then(async(): Promise<void> => {
      if (token !== latestStartToken || pendingStart?.token !== token) return;
      await startSession(request, token);
    })
    .catch((error: unknown): void => {
      if (token !== latestStartToken) return;
      void failSession(error instanceof Error ? error.message : 'failed to start OpenJOC Bilibili playback');
    })
    .finally((): void => {
      if (pendingStart?.token === token) pendingStart = null;
    });
}

function enqueueStopSession(announce: boolean, target: MediaSessionTarget): void {
  const current = currentSession;
  if (current !== null && sessionTargetMatches(sessionTarget(current), target)) current.abort.abort();
  startOperationTail = startOperationTail
    .catch(() => undefined)
    .then(async(): Promise<void> => {
      await stopSession(announce, target);
    })
    .catch((error: unknown): void => {
      void failSession(error instanceof Error ? error.message : 'failed to stop OpenJOC Bilibili playback');
    });
}

async function fetchSegmentWithPageFallback(session: CmafIndexSession, reference: CmafSegmentReference, signal: AbortSignal, tabId: number, generation: number): Promise<ReadonlyArray<CmafSample>> {
  try {
    return await fetchCmafSegment(session, reference, signal);
  } catch (error: unknown) {
    if (signal.aborted || !(error instanceof Error) || !error.message.includes('status 403')) throw error;
    const pageResponse = await requestPageRange(tabId, generation, session.url, reference.byteRangeStart, reference.byteRangeEnd, signal);
    if (pageResponse.status !== 206) throw new Error(`page-context CMAF range request returned status ${pageResponse.status}`);
    return parseCmafFragment(new Uint8Array(pageResponse.buffer), session.init.trackId);
  }
}

async function stopSession(announce: boolean, target: MediaSessionTarget | null = null): Promise<void> {
  const session = currentSession;
  if (session === null) return;
  if (target !== null && !sessionTargetMatches(sessionTarget(session), target)) return;
  session.abort.abort();
  if (session.preparationTimer !== null) window.clearTimeout(session.preparationTimer);
  session.preparationTimer = null;
  currentSession = null;
  resetAudio(++lastAudioGeneration);
  if (audioContext !== null) await audioContext.suspend();
  if (announce) sendStatus('disabled', null, session);
}

function sessionTarget(session: Session): MediaSessionTarget {
  return {
    mediaKey: `${session.request.mediaKey.bvid}:${session.request.mediaKey.aid}:${session.request.mediaKey.cid}`,
    generation: session.request.generation,
  };
}

function mediaKeyEquals(left: MediaKey, right: MediaKey): boolean {
  return left.bvid === right.bvid && left.aid === right.aid && left.cid === right.cid;
}

async function failSession(reason: string): Promise<void> {
  const session = currentSession;
  if (session === null) return;
  session.abort.abort();
  if (session.preparationTimer !== null) window.clearTimeout(session.preparationTimer);
  session.preparationTimer = null;
  sendStatus('error', reason, session);
  currentSession = null;
  resetAudio(++lastAudioGeneration);
  if (audioContext !== null) await audioContext.suspend();
}

function handleClock(message: Extract<RuntimeMessage, {target: 'offscreen'; type: 'clock'}>): void {
  const session = currentSession;
  if (session === null || message.tabId !== session.request.tabId || message.generation !== session.request.generation) return;
  if (message.playbackRate !== 1) {
    void failSession('unsupported playback rate');
    return;
  }
  if (shouldResyncForAudioLead(latestWorkletStats.currentAudioMediaSamples, message.mediaTimeSamples)) {
    enqueueStartSession({...session.request, videoTimeSamples: message.mediaTimeSamples, paused: message.paused, buffering: message.buffering});
    return;
  }
  latestVideoMediaSamples = message.mediaTimeSamples;
  lastVideoClockAtMs = performance.now();
  lastVideoPlaybackRate = message.playbackRate;
  session.isPaused = message.paused;
  session.isBuffering = message.buffering;
  updateDecoderProgressWatchdogs(session);
  audioNode?.port.postMessage({type: 'clock', generation: session.audioGeneration, mediaTimeSamples: message.mediaTimeSamples, paused: message.paused, buffering: message.buffering});
  worker?.postMessage({type: message.paused || message.buffering ? 'pause' : 'resume', generation: session.audioGeneration} satisfies WorkerCommand);
  if (message.paused || message.buffering) {
    session.phase = message.buffering ? 'buffering' : 'paused';
  } else {
    session.phase = resumeAudioPhase(session.phase, {isJocConfirmed: session.isJocConfirmed, isNativeMuted: session.isNativeMuted});
    if (session.isNativeMuted && audioContext !== null) void audioContext.resume();
  }
  sendStatus(session.phase, null, session);
  if (!session.isStreaming && session.index !== null && message.mediaTimeSamples + PUMP_THRESHOLD_SAMPLES >= session.windowEndSamples) void pumpSegments(session);
}

chrome.runtime.onMessage.addListener((rawMessage: unknown): void => {
  if (!isRuntimeMessage(rawMessage) || rawMessage.target !== 'offscreen') return;
  switch (rawMessage.type) {
    case 'start':
      enqueueStartSession(rawMessage);
      return;
    case 'clock':
      handleClock(rawMessage);
      return;
    case 'native-muted': {
      const session = currentSession;
      if (session === null || rawMessage.tabId !== session.request.tabId || rawMessage.generation !== session.request.generation) return;
      session.isNativeMuted = true;
      audioNode?.port.postMessage({type: 'arm', generation: session.audioGeneration});
      if (!session.isPaused && !session.isBuffering) {
        session.phase = 'active';
        if (audioContext !== null) void audioContext.resume();
      }
      sendStatus(session.phase, null, session);
      return;
    }
    case 'player-volume': {
      const session = currentSession;
      if (session === null || session.request.tabId !== rawMessage.tabId || session.request.requestId !== rawMessage.requestId || session.request.generation !== rawMessage.generation) return;
      session.playerVolume = rawMessage.volume;
      session.playerMuted = rawMessage.muted;
      applyOutputGain(session, rawMessage.activate || rawMessage.muted || rawMessage.volume === 0);
      if (rawMessage.activate && session.isJocConfirmed) {
        session.isNativeMuted = true;
        audioNode?.port.postMessage({type: 'arm', generation: session.audioGeneration});
        if (!session.isPaused && !session.isBuffering) {
          session.phase = 'active';
          if (audioContext !== null) void audioContext.resume();
        }
        sendStatus(session.phase, null, session);
      }
      return;
    }
    case 'disable':
      if (currentSession === null) {
        const pending = pendingStart;
        if (pending !== null && pending.request.tabId === rawMessage.tabId && mediaKeyEquals(pending.request.mediaKey, rawMessage.mediaKey) && rawMessage.generation >= pending.request.generation) latestStartToken += 1;
      } else if (currentSession.request.tabId === rawMessage.tabId && mediaKeyEquals(currentSession.request.mediaKey, rawMessage.mediaKey) && rawMessage.generation >= currentSession.request.generation) {
        enqueueStopSession(true, sessionTarget(currentSession));
      }
      return;
    case 'dialnorm': {
      const session = currentSession;
      if (session === null || rawMessage.tabId !== session.request.tabId || rawMessage.generation !== session.request.generation) return;
      enqueueStartSession({...session.request, dialnorm: rawMessage.mode, gainDb: session.gainDb, videoTimeSamples: latestVideoMediaSamples ?? session.request.videoTimeSamples});
      return;
    }
    case 'output-gain': {
      const pending = pendingStart;
      if (pending !== null && pending.request.tabId === rawMessage.tabId && pending.request.requestId === rawMessage.requestId && pending.request.generation === rawMessage.generation) pending.gainDb = rawMessage.gainDb;
      const session = currentSession;
      if (session === null || session.request.tabId !== rawMessage.tabId || session.request.requestId !== rawMessage.requestId || session.request.generation !== rawMessage.generation) return;
      session.gainDb = rawMessage.gainDb;
      applyOutputGain(session);
      return;
    }
    case 'page-media-range-response': {
      const pending = pendingPageRanges.get(rawMessage.requestId);
      if (pending === undefined) return;
      pendingPageRanges.delete(rawMessage.requestId);
      if (pending.generation !== rawMessage.generation) {
        pending.reject(new Error('page-context media response generation is stale'));
        return;
      }
      try {
        pending.resolve({status: rawMessage.status, contentRange: rawMessage.contentRange, error: rawMessage.error, buffer: base64ToArrayBuffer(rawMessage.bufferBase64)});
      } catch {
        pending.reject(new Error('page-context media response contains invalid base64 data'));
      }
      return;
    }
  }
});

window.setInterval((): void => {
  const session = currentSession;
  if (session !== null) sendStatus(session.phase, null, session);
}, 1_000);
window.setInterval(pumpFromEstimatedVideoClock, PREFETCH_INTERVAL_MS);
