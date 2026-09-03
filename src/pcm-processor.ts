// pattern: Imperative Shell

import {PcmQueue} from './audio-queue.js';
import {TimestampedPcmQueue} from './timestamped-pcm-queue.js';

type ProcessorMessage =
  | Readonly<{type: 'pcm'; generation: number; sequence: number; buffer: ArrayBuffer; ptsSamples: number | null}>
  | Readonly<{type: 'end'; generation: number}>
  | Readonly<{type: 'reset'; generation: number}>
  | Readonly<{type: 'clock'; generation: number; mediaTimeSamples: number; paused: boolean; buffering: boolean}>
  | Readonly<{type: 'arm'; generation: number}>;

export type ProcessorStats = Readonly<{
  readonly type: 'stats';
  readonly generation: number;
  readonly queuedAudioMs: number;
  readonly underrunCount: number;
  readonly sampleRate: number;
  readonly isEndOfStream: boolean;
  readonly acceptedSequence: number;
  readonly currentAudioMediaSamples: number | null;
  readonly driftMs: number | null;
  readonly resyncCount: number;
  readonly processGapMaxMs: number;
  readonly processGapOver20MsCount: number;
  readonly playedQuantumCount: number;
  readonly silentQuantumCount: number;
  readonly lastTimestampedReadType: 'played' | 'wait' | 'trim' | 'underrun' | null;
}>;

class OpenJocPcmProcessor extends AudioWorkletProcessor {
  private readonly queue: PcmQueue;
  private readonly timestampedQueue: TimestampedPcmQueue;
  private processCount = 0;
  private isEndOfStream = false;
  private isArmed = false;
  private isPaused = false;
  private isBuffering = false;
  private generation = 0;
  private acceptedSequence = 0;
  private masterMediaSamples: number | null = null;
  private resyncCount = 0;
  private lastProcessWallTimeMs: number | null = null;
  private processGapMaxMs = 0;
  private processGapOver20MsCount = 0;
  private playedQuantumCount = 0;
  private silentQuantumCount = 0;
  private lastTimestampedReadType: ProcessorStats['lastTimestampedReadType'] = null;

  public constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    this.queue = new PcmQueue({sampleRate, channels: 2, maxQueuedMs: 2000});
    this.timestampedQueue = new TimestampedPcmQueue({sampleRate, channels: 2, maxQueuedMs: 4000});
    this.port.onmessage = (event: MessageEvent<ProcessorMessage>): void => {
      if (event.data.type === 'reset') {
        if (event.data.generation < this.generation) {
          return;
        }
        this.generation = event.data.generation;
        this.queue.reset();
        this.timestampedQueue.reset();
        this.acceptedSequence = 0;
        this.isEndOfStream = false;
        this.isArmed = false;
        this.isPaused = false;
        this.isBuffering = false;
        this.masterMediaSamples = null;
        this.resyncCount = 0;
        this.lastProcessWallTimeMs = null;
        this.processGapMaxMs = 0;
        this.processGapOver20MsCount = 0;
        this.playedQuantumCount = 0;
        this.silentQuantumCount = 0;
        this.lastTimestampedReadType = null;
        this.postStats();
        return;
      }
      if (event.data.type === 'end') {
        if (event.data.generation !== this.generation) {
          return;
        }
        this.isEndOfStream = true;
        this.postStats();
        return;
      }
      if (event.data.type === 'arm') {
        if (event.data.generation !== this.generation) return;
        this.isArmed = true;
        this.postStats();
        return;
      }
      if (event.data.type === 'clock') {
        if (event.data.generation !== this.generation) return;
        this.masterMediaSamples = event.data.mediaTimeSamples;
        this.isPaused = event.data.paused;
        this.isBuffering = event.data.buffering;
        this.postStats();
        return;
      }
      if (event.data.generation !== this.generation) {
        return;
      }
      try {
        if (event.data.ptsSamples === null) {
          this.isArmed = true;
          if (this.timestampedQueue.currentMediaSamples() !== null) {
            throw new Error('timestamped and untimestamped PCM cannot share one queue');
          }
          this.queue.enqueue(new Float32Array(event.data.buffer));
        } else {
          if (this.queue.queuedAudioMs() > 0) {
            throw new Error('timestamped and untimestamped PCM cannot share one queue');
          }
          this.timestampedQueue.enqueue({ptsSamples: event.data.ptsSamples, samples: new Float32Array(event.data.buffer)});
        }
        this.acceptedSequence = event.data.sequence;
        this.postStats();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'AudioWorklet PCM queue failed';
        this.port.postMessage({type: 'error', message});
      }
    };
  }

  public process(
    _inputs: Array<Array<Float32Array>>,
    outputs: Array<Array<Float32Array>>,
  ): boolean {
    const processWallTimeMs = typeof performance === 'undefined' ? this.processCount * 128 * 1_000 / sampleRate : performance.now();
    if (this.lastProcessWallTimeMs !== null) {
      const processGapMs = Math.max(0, processWallTimeMs - this.lastProcessWallTimeMs);
      this.processGapMaxMs = Math.max(this.processGapMaxMs, processGapMs);
      if (processGapMs >= 20) this.processGapOver20MsCount += 1;
    }
    this.lastProcessWallTimeMs = processWallTimeMs;
    const output = outputs[0];
    if (output !== undefined && this.isArmed && !this.isPaused && !this.isBuffering) {
      const hasTimestampedPcm = this.timestampedQueue.currentMediaSamples() !== null || this.masterMediaSamples !== null;
      if (!hasTimestampedPcm && this.isEndOfStream && this.queue.queuedAudioMs() === 0) {
        output.forEach((channel) => channel.fill(0));
      } else if (hasTimestampedPcm) {
        const result = this.timestampedQueue.readForMasterClock(output, this.masterMediaSamples ?? 0, 2_400, this.isEndOfStream);
        if (result.type === 'trim') this.resyncCount += 1;
        this.lastTimestampedReadType = result.type;
        if (result.mediaSamples === null) this.silentQuantumCount += 1;
        else this.playedQuantumCount += 1;
      } else {
        this.queue.read(output, this.isEndOfStream);
      }
    } else if (output !== undefined) {
      output.forEach((channel) => channel.fill(0));
    }
    this.processCount += 1;
    if (this.processCount % 32 === 0) {
      this.postStats();
    }
    return true;
  }

  private postStats(): void {
    const currentAudioMediaSamples = this.timestampedQueue.currentMediaSamples();
    const hasTimestampedPcm = currentAudioMediaSamples !== null || this.masterMediaSamples !== null;
    const driftMs = this.masterMediaSamples === null || currentAudioMediaSamples === null
      ? null
      : (currentAudioMediaSamples - this.masterMediaSamples) * 1000 / sampleRate;
    const stats: ProcessorStats = {
      type: 'stats',
      generation: this.generation,
      queuedAudioMs: hasTimestampedPcm ? this.timestampedQueue.queuedAudioMs() : this.queue.queuedAudioMs(),
      underrunCount: hasTimestampedPcm ? this.timestampedQueue.underrunCount() : this.queue.underrunCount(),
      sampleRate,
      isEndOfStream: this.isEndOfStream,
      acceptedSequence: this.acceptedSequence,
      currentAudioMediaSamples,
      driftMs,
      resyncCount: this.resyncCount,
      processGapMaxMs: this.processGapMaxMs,
      processGapOver20MsCount: this.processGapOver20MsCount,
      playedQuantumCount: this.playedQuantumCount,
      silentQuantumCount: this.silentQuantumCount,
      lastTimestampedReadType: this.lastTimestampedReadType,
    };
    this.port.postMessage(stats);
  }
}

registerProcessor('openjoc-pcm', OpenJocPcmProcessor);
