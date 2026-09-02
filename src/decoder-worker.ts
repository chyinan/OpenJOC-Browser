// pattern: Imperative Shell

import {loadOpenJocWasm, WasmDecoderClient, type WasmDecoderStatus} from './wasm-bindings.js';
import {isCurrentGeneration} from './generation.js';
import {DecoderGenerationSlot} from './decoder-generation.js';
import {MAX_INPUT_FILE_BYTES, type WorkerCommand, type WorkerMessage} from './worker-protocol.js';

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const CHUNK_BYTES = 64 * 1024;
const MAX_DECODE_QUEUE_MS = 1000;

const decoderSlot = new DecoderGenerationSlot<WasmDecoderClient>(
  async (): Promise<WasmDecoderClient> => loadOpenJocWasm(new URL('./wasm/openjoc_wasm.wasm', import.meta.url)),
  (decoder): void => decoder.destroy(),
);
let isPaused = false;
let queuedAudioMs = 0;
let generation = 0;
let pcmSequence = 0;
let acceptedSequence = 0;
let wakeResolver: (() => void) | null = null;

function postMessage(message: WorkerMessage, transfer: ArrayBuffer[] = []): void {
  workerScope.postMessage(message, transfer);
}

function signalWake(): void {
  const resolve = wakeResolver;
  wakeResolver = null;
  resolve?.();
}

function waitForWake(): Promise<void> {
  return new Promise<void>((resolve) => {
    wakeResolver = resolve;
  });
}

function yieldToWorkerEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    workerScope.setTimeout(resolve, 0);
  });
}

async function waitForPlaybackBudget(): Promise<void> {
  while (isPaused || queuedAudioMs > MAX_DECODE_QUEUE_MS) {
    await waitForWake();
  }
}

async function waitForPcmAcceptance(sequence: number, currentGeneration: number): Promise<boolean> {
  while (currentGeneration === generation && acceptedSequence < sequence) {
    await waitForWake();
  }
  return currentGeneration === generation;
}

function requireDecoder(): WasmDecoderClient {
  const decoder = decoderSlot.current();
  if (decoder === null) {
    throw new Error('OpenJOC WASM decoder is not initialized');
  }
  return decoder;
}

function postDecoderStatus(): void {
  const currentDecoder = requireDecoder();
  postMessage({type: 'decoder-status', generation, status: currentDecoder.status()});
}

async function postAvailablePcm(currentGeneration: number): Promise<void> {
  const currentDecoder = requireDecoder();
  while (true) {
    if (!isCurrentGeneration(currentGeneration, generation)) {
      return;
    }
    const pcm = currentDecoder.receivePcm();
    if (pcm === null) {
      break;
    }
    const buffer = new ArrayBuffer(pcm.byteLength);
    new Float32Array(buffer).set(pcm);
    pcmSequence += 1;
    const sequence = pcmSequence;
    postMessage({type: 'pcm', generation, sequence, buffer, samples: pcm.length / 2}, [buffer]);
    await yieldToWorkerEventLoop();
    if (!isCurrentGeneration(currentGeneration, generation)) {
      return;
    }
    if (!(await waitForPcmAcceptance(sequence, currentGeneration))) {
      return;
    }
    await waitForPlaybackBudget();
  }
  postDecoderStatus();
}

function throwIfError(status: WasmDecoderStatus): void {
  if (status === -1) {
    const detail = requireDecoder().errorDetail();
    throw new Error(detail ?? 'OpenJOC WASM decoder failed');
  }
}

async function pumpAfterOutput(status: WasmDecoderStatus, currentGeneration: number): Promise<WasmDecoderStatus> {
  let nextStatus = status;
  while (nextStatus === 1 || nextStatus === 2) {
    await postAvailablePcm(currentGeneration);
    if (!isCurrentGeneration(currentGeneration, generation)) {
      return -1;
    }
    nextStatus = requireDecoder().pushBytes(new Uint8Array(0));
    throwIfError(nextStatus);
  }
  return nextStatus;
}

async function decodeBytes(bytes: ArrayBuffer, currentGeneration: number): Promise<void> {
  const currentDecoder = requireDecoder();
  const input = new Uint8Array(bytes);
  for (let offset = 0; offset < input.length; offset += CHUNK_BYTES) {
    if (!isCurrentGeneration(currentGeneration, generation)) {
      return;
    }
    await waitForPlaybackBudget();
    if (!isCurrentGeneration(currentGeneration, generation)) {
      return;
    }
    const end = Math.min(offset + CHUNK_BYTES, input.length);
    let status = currentDecoder.pushBytes(input.subarray(offset, end));
    throwIfError(status);
    await postAvailablePcm(currentGeneration);
    status = await pumpAfterOutput(status, currentGeneration);
    if (!isCurrentGeneration(currentGeneration, generation)) {
      return;
    }
    postDecoderStatus();
    await yieldToWorkerEventLoop();
  }

  while (isCurrentGeneration(currentGeneration, generation)) {
    await waitForPlaybackBudget();
    if (!isCurrentGeneration(currentGeneration, generation)) {
      return;
    }
    const status = currentDecoder.flush();
    throwIfError(status);
    await postAvailablePcm(currentGeneration);
    if (!isCurrentGeneration(currentGeneration, generation)) {
      return;
    }
    postDecoderStatus();
    if (status === 3) {
      break;
    }
    await yieldToWorkerEventLoop();
  }
  if (isCurrentGeneration(currentGeneration, generation)) {
    postMessage({type: 'decode-complete', generation});
  }
}

async function handleDecode(bytes: ArrayBuffer, requestedGeneration: number): Promise<void> {
  if (bytes.byteLength > MAX_INPUT_FILE_BYTES) {
    throw new Error(`input file exceeds the ${MAX_INPUT_FILE_BYTES} byte Phase-0 limit`);
  }
  if (requestedGeneration < generation) {
    return;
  }
  generation = requestedGeneration;
  const currentGeneration = generation;
  try {
    const loadedDecoder = await decoderSlot.start(currentGeneration);
    if (!isCurrentGeneration(currentGeneration, generation) || loadedDecoder === null) {
      return;
    }
    isPaused = false;
    queuedAudioMs = 0;
    pcmSequence = 0;
    acceptedSequence = 0;
    postDecoderStatus();
    await decodeBytes(bytes, currentGeneration);
  } finally {
    decoderSlot.finish(currentGeneration);
  }
}

async function handleCommand(command: WorkerCommand): Promise<void> {
  switch (command.type) {
    case 'decode':
      await handleDecode(command.bytes, command.generation);
      return;
    case 'pause':
      if (!isCurrentGeneration(command.generation, generation)) return;
      isPaused = true;
      return;
    case 'resume':
      if (!isCurrentGeneration(command.generation, generation)) return;
      isPaused = false;
      signalWake();
      return;
    case 'reset':
      if (command.generation < generation) return;
      generation = command.generation;
      decoderSlot.reset(command.generation, (decoder): void => decoder.reset());
      isPaused = false;
      queuedAudioMs = 0;
      acceptedSequence = 0;
      if (decoderSlot.current() !== null) {
        postDecoderStatus();
      }
      signalWake();
      return;
    case 'queue-stats':
      if (!isCurrentGeneration(command.generation, generation)) return;
      queuedAudioMs = command.queuedAudioMs;
      acceptedSequence = Math.max(acceptedSequence, command.acceptedSequence);
      signalWake();
      return;
  }
}

workerScope.onmessage = (event: MessageEvent<WorkerCommand>): void => {
  void handleCommand(event.data).catch((error: unknown) => {
    if (!isCurrentGeneration(event.data.generation, generation)) {
      return;
    }
    const message = error instanceof Error ? error.message : 'OpenJOC worker failed';
    const status = decoderSlot.current()?.status();
    postMessage({
      type: 'error',
      generation,
      message,
      category: status?.errorCategory ?? 'internal',
      detail: status?.errorDetail ?? message,
    });
  });
};
