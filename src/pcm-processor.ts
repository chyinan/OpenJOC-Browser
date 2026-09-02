// pattern: Imperative Shell

import {PcmQueue} from './audio-queue.js';

type ProcessorMessage =
  | Readonly<{type: 'pcm'; generation: number; sequence: number; buffer: ArrayBuffer}>
  | Readonly<{type: 'end'; generation: number}>
  | Readonly<{type: 'reset'; generation: number}>;

export type ProcessorStats = Readonly<{
  readonly type: 'stats';
  readonly generation: number;
  readonly queuedAudioMs: number;
  readonly underrunCount: number;
  readonly sampleRate: number;
  readonly isEndOfStream: boolean;
  readonly acceptedSequence: number;
}>;

class OpenJocPcmProcessor extends AudioWorkletProcessor {
  private readonly queue: PcmQueue;
  private processCount = 0;
  private isEndOfStream = false;
  private generation = 0;
  private acceptedSequence = 0;

  public constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    this.queue = new PcmQueue({sampleRate, channels: 2, maxQueuedMs: 2000});
    this.port.onmessage = (event: MessageEvent<ProcessorMessage>): void => {
      if (event.data.type === 'reset') {
        if (event.data.generation < this.generation) {
          return;
        }
        this.generation = event.data.generation;
        this.queue.reset();
        this.acceptedSequence = 0;
        this.isEndOfStream = false;
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
      if (event.data.generation !== this.generation) {
        return;
      }
      try {
        this.queue.enqueue(new Float32Array(event.data.buffer));
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
    const output = outputs[0];
    if (output !== undefined) {
      if (this.isEndOfStream && this.queue.queuedAudioMs() === 0) {
        output.forEach((channel) => channel.fill(0));
      } else {
        this.queue.read(output, this.isEndOfStream);
      }
    }
    this.processCount += 1;
    if (this.processCount % 32 === 0) {
      this.postStats();
    }
    return true;
  }

  private postStats(): void {
    const stats: ProcessorStats = {
      type: 'stats',
      generation: this.generation,
      queuedAudioMs: this.queue.queuedAudioMs(),
      underrunCount: this.queue.underrunCount(),
      sampleRate,
      isEndOfStream: this.isEndOfStream,
      acceptedSequence: this.acceptedSequence,
    };
    this.port.postMessage(stats);
  }
}

registerProcessor('openjoc-pcm', OpenJocPcmProcessor);
