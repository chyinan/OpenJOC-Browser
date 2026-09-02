// pattern: Imperative Shell

import {MAX_INPUT_FILE_BYTES, type DecoderWorkerStatus, type WorkerCommand, type WorkerMessage} from './worker-protocol.js';

const PHASE0_SAMPLE_RATE = 48_000;
const PHASE0_CHANNELS = 2;
const PREROLL_MS = 128;

const fileInput = requireElement<HTMLInputElement>('file-input');
const playButton = requireElement<HTMLButtonElement>('play-button');
const pauseButton = requireElement<HTMLButtonElement>('pause-button');
const stopButton = requireElement<HTMLButtonElement>('stop-button');
const fileNameLabel = requireElement<HTMLElement>('file-name');
const stateLabel = requireElement<HTMLElement>('state');
const diagnostics = requireElement<HTMLElement>('diagnostics');
const errorLabel = requireElement<HTMLElement>('error');

let worker: Worker | null = null;
let audioContext: AudioContext | null = null;
let audioNode: AudioWorkletNode | null = null;
let selectedFile: File | null = null;
let isPlaying = false;
let isDecodeComplete = false;
let hasDecodeStarted = false;
let playbackGeneration = 0;
let prerollResolver: (() => void) | null = null;
let prerollRejecter: ((error: Error) => void) | null = null;
let playOperation: Promise<void> | null = null;
let latestDecoderStatus: DecoderWorkerStatus | null = null;
let latestQueueAudioMs = 0;
let latestQueueUnderruns = 0;
let latestAudioSampleRate = 0;
let latestErrorCategory: string | null = null;
let latestErrorDetail: string | null = null;

function requireElement<ElementType extends HTMLElement>(id: string): ElementType {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`missing player element: ${id}`);
  }
  return element as ElementType;
}

function setError(error: unknown): void {
  const message = error instanceof Error ? error.message : 'OpenJOC Browser playback failed';
  isPlaying = false;
  isDecodeComplete = false;
  hasDecodeStarted = false;
  playbackGeneration += 1;
  worker?.postMessage({type: 'reset', generation: playbackGeneration} satisfies WorkerCommand);
  audioNode?.port.postMessage({type: 'reset', generation: playbackGeneration});
  void audioContext?.suspend();
  errorLabel.textContent = message;
  errorLabel.hidden = false;
  stateLabel.textContent = 'error';
  prerollRejecter?.(new Error(message));
  prerollResolver = null;
  prerollRejecter = null;
}

function clearError(): void {
  errorLabel.textContent = '';
  errorLabel.hidden = true;
}

function ensureWorker(): Worker {
  if (worker === null) {
    worker = new Worker(new URL('./decoder-worker.js', import.meta.url), {type: 'module'});
    worker.onmessage = (event: MessageEvent<WorkerMessage>): void => {
      handleWorkerMessage(event.data);
    };
    worker.onerror = (event: ErrorEvent): void => {
      setError(new Error(event.message || 'OpenJOC decoder worker failed'));
    };
  }
  return worker;
}

async function ensureAudio(): Promise<AudioContext> {
  if (audioContext === null) {
    const nextContext = new AudioContext({sampleRate: PHASE0_SAMPLE_RATE});
    try {
      if (nextContext.sampleRate !== PHASE0_SAMPLE_RATE) {
        throw new Error(`AudioContext negotiated ${nextContext.sampleRate} Hz, expected 48000 Hz`);
      }
      await nextContext.audioWorklet.addModule(new URL('./pcm-processor.js', import.meta.url));
      const nextNode = new AudioWorkletNode(nextContext, 'openjoc-pcm', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [PHASE0_CHANNELS],
      });
      nextNode.port.onmessage = (event: MessageEvent<unknown>): void => {
        handleProcessorMessage(event.data);
      };
      nextNode.connect(nextContext.destination);
      audioContext = nextContext;
      audioNode = nextNode;
    } catch (error: unknown) {
      await nextContext.close();
      throw error;
    }
  }
  return audioContext;
}

function waitForPreroll(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    prerollResolver = resolve;
    prerollRejecter = reject;
  });
}

function maybeResolvePreroll(queuedAudioMs: number, isEndOfStream = false): void {
  if (queuedAudioMs >= PREROLL_MS || isEndOfStream) {
    prerollResolver?.();
    prerollResolver = null;
    prerollRejecter = null;
  }
}

function sendWorkerCommand(command: WorkerCommand, transfer: ArrayBuffer[] = []): void {
  ensureWorker().postMessage(command, transfer);
}

function clearPlaybackState(): void {
  isPlaying = false;
  isDecodeComplete = false;
  hasDecodeStarted = false;
  playbackGeneration += 1;
  prerollResolver?.();
  prerollResolver = null;
  prerollRejecter = null;
  worker?.postMessage({type: 'reset', generation: playbackGeneration} satisfies WorkerCommand);
  audioNode?.port.postMessage({type: 'reset', generation: playbackGeneration});
  latestDecoderStatus = null;
  latestQueueAudioMs = 0;
  latestQueueUnderruns = 0;
  latestAudioSampleRate = 0;
  latestErrorCategory = null;
  latestErrorDetail = null;
  renderDiagnostics();
}

function handleWorkerMessage(message: WorkerMessage): void {
  if (message.generation !== playbackGeneration) {
    return;
  }
  switch (message.type) {
    case 'pcm':
      if (audioNode === null) {
        setError(new Error('AudioWorklet node is not initialized'));
        return;
      }
      audioNode.port.postMessage({type: 'pcm', generation: message.generation, sequence: message.sequence, buffer: message.buffer}, [message.buffer]);
      return;
    case 'decoder-status':
      renderDecoderStatus(message.status);
      return;
    case 'decode-complete':
      isDecodeComplete = true;
      audioNode?.port.postMessage({type: 'end', generation: message.generation});
      stateLabel.textContent = isPlaying ? 'playing' : 'ready';
      return;
    case 'error':
      latestErrorCategory = message.category;
      latestErrorDetail = message.detail ?? message.message;
      renderDiagnostics();
      setError(new Error(message.message));
      return;
  }
}

function handleProcessorMessage(message: unknown): void {
  if (!isRecord(message) || message.type !== 'stats') {
    if (isRecord(message) && message.type === 'error' && typeof message.message === 'string') {
      setError(new Error(message.message));
    }
    return;
  }
  if (message.generation !== playbackGeneration) {
    return;
  }
  const queuedAudioMs = typeof message.queuedAudioMs === 'number' ? message.queuedAudioMs : 0;
  const underrunCount = typeof message.underrunCount === 'number' ? message.underrunCount : 0;
  const currentSampleRate = typeof message.sampleRate === 'number' ? message.sampleRate : 0;
  const isEndOfStream = message.isEndOfStream === true;
  const acceptedSequence = typeof message.acceptedSequence === 'number' ? message.acceptedSequence : 0;
  latestQueueAudioMs = queuedAudioMs;
  latestQueueUnderruns = underrunCount;
  latestAudioSampleRate = currentSampleRate;
  renderDiagnostics();
  sendWorkerCommand({type: 'queue-stats', generation: playbackGeneration, queuedAudioMs, acceptedSequence});
  maybeResolvePreroll(queuedAudioMs, isEndOfStream);
}

function renderDecoderStatus(status: DecoderWorkerStatus): void {
  latestDecoderStatus = status;
  renderDiagnostics();
}

function renderDiagnostics(): void {
  const status = latestDecoderStatus;
  if (status === null) {
    diagnostics.textContent = 'waiting for decoder';
    return;
  }
  diagnostics.textContent = JSON.stringify({
    decoder: 'OpenJOC',
    input: 'E-AC-3 JOC',
    profile: status.profile ?? 'pending',
    downmixIndex: status.downmixIndex,
    objects: status.objectCount,
    complexityIndex: status.complexityIndex,
    renderer: 'Stereo (Speakers)',
    sampleRate: status.sampleRate,
    outputChannels: status.outputChannels,
    queueAudioMs: Number(latestQueueAudioMs.toFixed(2)),
    underruns: latestQueueUnderruns,
    audioSampleRate: latestAudioSampleRate,
    prerollMs: status.prerollMs,
    decodeAccessUnits: status.decodedAccessUnits,
    outputFrames: status.outputFrames,
    outputSamples: status.outputSamples,
    decodeMeanMs: status.decodeMeanMs,
    decodeP95Ms: status.decodeP95Ms,
    decodeMaxMs: status.decodeMaxMs,
    renderMeanMs: status.renderMeanMs,
    renderP95Ms: status.renderP95Ms,
    renderMaxMs: status.renderMaxMs,
    totalMeanMs: status.totalMeanMs,
    totalP95Ms: status.totalP95Ms,
    totalMaxMs: status.totalMaxMs,
    realtimeFactor: status.realtimeFactor,
    wasmMemoryBytes: status.wasmMemoryBytes,
    wasmMemoryPeakBytes: status.wasmMemoryPeakBytes,
    wasmMemoryGrowthBytes: status.wasmMemoryGrowthBytes,
    errorCategory: status.errorCategory ?? latestErrorCategory,
    errorDetail: status.errorDetail ?? latestErrorDetail,
    nativeDolbyDecoderUsed: false,
  }, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function playSelectedFile(): Promise<void> {
  clearError();
  const file = selectedFile;
  if (file === null) {
    setError(new Error('choose a local .ec3 file first'));
    return;
  }
  if (isPlaying) {
    return;
  }
  const operationGeneration = playbackGeneration;
  const context = await ensureAudio();
  if (operationGeneration !== playbackGeneration || selectedFile !== file) {
    return;
  }
  isPlaying = true;
  stateLabel.textContent = 'preparing';
  if (hasDecodeStarted) {
    sendWorkerCommand({type: 'resume', generation: playbackGeneration});
    await context.resume();
    if (!isPlaying || operationGeneration !== playbackGeneration) {
      return;
    }
    stateLabel.textContent = 'playing';
    return;
  }
  isDecodeComplete = false;
  if (file.size > MAX_INPUT_FILE_BYTES) {
    throw new Error(`input file exceeds the ${MAX_INPUT_FILE_BYTES} byte Phase-0 limit`);
  }
  await context.suspend();
  if (operationGeneration !== playbackGeneration || selectedFile !== file) {
    return;
  }
  audioNode?.port.postMessage({type: 'reset', generation: playbackGeneration});
  const preroll = waitForPreroll();
  const bytes = await file.arrayBuffer();
  if (!isPlaying || operationGeneration !== playbackGeneration || selectedFile !== file) {
    return;
  }
  hasDecodeStarted = true;
  sendWorkerCommand({type: 'decode', generation: playbackGeneration, bytes}, [bytes]);
  await preroll;
  if (!isPlaying || operationGeneration !== playbackGeneration) {
    return;
  }
  await context.resume();
  stateLabel.textContent = 'playing';
}

async function pausePlayback(): Promise<void> {
  if (audioContext === null || !isPlaying) {
    return;
  }
  isPlaying = false;
  sendWorkerCommand({type: 'pause', generation: playbackGeneration});
  prerollResolver?.();
  prerollResolver = null;
  prerollRejecter = null;
  await audioContext.suspend();
  stateLabel.textContent = 'paused';
}

async function stopPlayback(): Promise<void> {
  clearPlaybackState();
  if (audioContext !== null) {
    await audioContext.suspend();
  }
  stateLabel.textContent = 'stopped';
}

fileInput.addEventListener('change', (): void => {
  clearPlaybackState();
  selectedFile = fileInput.files?.[0] ?? null;
  fileNameLabel.textContent = selectedFile?.name ?? 'no file selected';
  stateLabel.textContent = selectedFile === null ? 'idle' : 'ready';
  clearError();
});
playButton.addEventListener('click', (): void => {
  if (playOperation !== null) {
    return;
  }
  playOperation = playSelectedFile()
    .catch(setError)
    .finally(() => {
      playOperation = null;
    });
});
pauseButton.addEventListener('click', (): void => {
  void pausePlayback().catch(setError);
});
stopButton.addEventListener('click', (): void => {
  void stopPlayback().catch(setError);
});
