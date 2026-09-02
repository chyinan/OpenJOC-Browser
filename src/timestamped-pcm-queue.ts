// pattern: Functional Core

export type TimestampedPcmQueueConfig = Readonly<{
  readonly sampleRate: number;
  readonly channels: number;
  readonly maxQueuedMs: number;
}>;

export type TimestampedPcmBlock = Readonly<{
  readonly ptsSamples: number;
  readonly samples: Readonly<Float32Array>;
}>;

export type TimestampedReadResult = Readonly<{
  readonly type: 'played' | 'wait' | 'trim' | 'underrun';
  readonly mediaSamples: number | null;
  readonly discardedSamples: number;
}>;

type QueueBlock = Readonly<{
  readonly ptsSamples: number;
  readonly samples: Float32Array;
}>;

/** Bounded PCM queue that follows a video-provided media sample clock. */
export class TimestampedPcmQueue {
  private readonly sampleRate: number;
  private readonly channels: number;
  private readonly maxQueuedSamples: number;
  private readonly blocks: Array<QueueBlock> = [];
  private currentBlockOffset = 0;
  private queuedSamples = 0;
  private underruns = 0;
  private lastEnqueuedEnd: number | null = null;
  private lastConsumedMediaSamples: number | null = null;

  public constructor(config: TimestampedPcmQueueConfig) {
    if (!Number.isInteger(config.sampleRate) || config.sampleRate <= 0) {
      throw new Error('invalid timestamped PCM queue sample rate');
    }
    if (!Number.isInteger(config.channels) || config.channels <= 0) {
      throw new Error('invalid timestamped PCM queue channel count');
    }
    if (!Number.isFinite(config.maxQueuedMs) || config.maxQueuedMs <= 0) {
      throw new Error('invalid timestamped PCM queue duration limit');
    }
    this.sampleRate = config.sampleRate;
    this.channels = config.channels;
    this.maxQueuedSamples = Math.floor(config.sampleRate * config.maxQueuedMs / 1000);
    if (this.maxQueuedSamples < 1) {
      throw new Error('timestamped PCM queue duration limit is smaller than one sample frame');
    }
  }

  public enqueue(block: TimestampedPcmBlock): void {
    if (!Number.isSafeInteger(block.ptsSamples) || block.ptsSamples < 0) {
      throw new Error('timestamped PCM block has an invalid PTS');
    }
    if (block.samples.length === 0 || block.samples.length % this.channels !== 0) {
      throw new Error('timestamped PCM block does not contain complete interleaved frames');
    }
    if (!block.samples.every((sample) => Number.isFinite(sample))) {
      throw new Error('timestamped PCM block contains a non-finite sample');
    }
    const sampleCount = block.samples.length / this.channels;
    if (this.queuedSamples + sampleCount > this.maxQueuedSamples) {
      throw new Error('timestamped PCM queue duration limit exceeded');
    }
    if (this.lastEnqueuedEnd !== null && block.ptsSamples < this.lastEnqueuedEnd) {
      throw new Error('timestamped PCM block PTS moves backwards');
    }
    this.blocks.push({ptsSamples: block.ptsSamples, samples: block.samples.slice()});
    this.queuedSamples += sampleCount;
    this.lastEnqueuedEnd = block.ptsSamples + sampleCount;
  }

  public readForMasterClock(
    outputs: ReadonlyArray<Float32Array>,
    targetMediaSamples: number,
    toleranceSamples: number,
    allowTerminalSilence = false,
  ): TimestampedReadResult {
    validateOutputs(outputs, this.channels);
    if (!Number.isSafeInteger(targetMediaSamples) || targetMediaSamples < 0) {
      throw new Error('timestamped PCM target PTS is invalid');
    }
    if (!Number.isSafeInteger(toleranceSamples) || toleranceSamples < 0) {
      throw new Error('timestamped PCM tolerance is invalid');
    }
    outputs.forEach((output) => output.fill(0));
    const staleLimit = targetMediaSamples - toleranceSamples;
    let discardedSamples = 0;
    while (this.blocks.length > 0) {
      const block = this.blocks[0];
      if (block === undefined) break;
      const blockMediaSamples = block.ptsSamples + this.currentBlockOffset;
      if (blockMediaSamples >= staleLimit) break;
      const available = block.samples.length / this.channels - this.currentBlockOffset;
      const discard = Math.min(available, Math.max(0, staleLimit - blockMediaSamples));
      this.currentBlockOffset += discard;
      this.queuedSamples -= discard;
      discardedSamples += discard;
      if (this.currentBlockOffset === block.samples.length / this.channels) {
        this.blocks.shift();
        this.currentBlockOffset = 0;
      }
    }
    const head = this.blocks[0];
    if (head === undefined) {
      if (discardedSamples > 0) {
        return {type: 'trim', mediaSamples: null, discardedSamples};
      }
      if (!allowTerminalSilence) this.underruns += 1;
      return {type: 'underrun', mediaSamples: null, discardedSamples: 0};
    }
    const headMediaSamples = head.ptsSamples + this.currentBlockOffset;
    if (headMediaSamples > targetMediaSamples + toleranceSamples) {
      return {type: 'wait', mediaSamples: headMediaSamples, discardedSamples};
    }
    const frameCount = outputs[0]?.length ?? 0;
    const written = this.copyFrames(outputs, frameCount);
    if (written < frameCount && !allowTerminalSilence) this.underruns += 1;
    this.lastConsumedMediaSamples = headMediaSamples + written;
    return {
      type: discardedSamples > 0 ? 'trim' : written === 0 ? 'underrun' : 'played',
      mediaSamples: headMediaSamples,
      discardedSamples,
    };
  }

  public queuedAudioMs(): number {
    return this.queuedSamples * 1000 / this.sampleRate;
  }

  public underrunCount(): number {
    return this.underruns;
  }

  public currentMediaSamples(): number | null {
    const block = this.blocks[0];
    return block === undefined
      ? this.lastConsumedMediaSamples
      : block.ptsSamples + this.currentBlockOffset;
  }

  public reset(): void {
    this.blocks.length = 0;
    this.currentBlockOffset = 0;
    this.queuedSamples = 0;
    this.underruns = 0;
    this.lastEnqueuedEnd = null;
    this.lastConsumedMediaSamples = null;
  }

  private copyFrames(outputs: ReadonlyArray<Float32Array>, frameCount: number): number {
    let written = 0;
    while (written < frameCount) {
      const block = this.blocks[0];
      if (block === undefined) break;
      const available = block.samples.length / this.channels - this.currentBlockOffset;
      const copyCount = Math.min(frameCount - written, available);
      for (let frame = 0; frame < copyCount; frame += 1) {
        for (let channel = 0; channel < this.channels; channel += 1) {
          const output = outputs[channel];
          if (output !== undefined) {
            output[written + frame] = block.samples[(this.currentBlockOffset + frame) * this.channels + channel] ?? 0;
          }
        }
      }
      written += copyCount;
      this.currentBlockOffset += copyCount;
      this.queuedSamples -= copyCount;
      if (this.currentBlockOffset === block.samples.length / this.channels) {
        this.blocks.shift();
        this.currentBlockOffset = 0;
      }
    }
    return written;
  }
}

function validateOutputs(outputs: ReadonlyArray<Float32Array>, channels: number): void {
  if (outputs.length !== channels) throw new Error('timestamped PCM output channel count mismatch');
  const frameCount = outputs[0]?.length ?? 0;
  if (outputs.some((output) => output.length !== frameCount)) {
    throw new Error('timestamped PCM output frame lengths mismatch');
  }
}
