// pattern: Functional Core

export type PcmQueueConfig = Readonly<{
  sampleRate: number;
  channels: number;
  maxQueuedMs: number;
}>;

/** Bounded interleaved PCM queue used by the AudioWorklet adapter. */
export class PcmQueue {
  private readonly sampleRate: number;
  private readonly channels: number;
  private readonly maxQueuedSamples: number;
  private readonly blocks: Array<Float32Array> = [];
  private currentBlockOffset = 0;
  private queuedSamples = 0;
  private underruns = 0;

  public constructor(config: PcmQueueConfig) {
    if (!Number.isInteger(config.sampleRate) || config.sampleRate <= 0) {
      throw new Error('invalid PCM queue sample rate');
    }
    if (!Number.isInteger(config.channels) || config.channels <= 0) {
      throw new Error('invalid PCM queue channel count');
    }
    if (!Number.isFinite(config.maxQueuedMs) || config.maxQueuedMs <= 0) {
      throw new Error('invalid PCM queue duration limit');
    }
    this.sampleRate = config.sampleRate;
    this.channels = config.channels;
    this.maxQueuedSamples = Math.floor(config.sampleRate * config.maxQueuedMs / 1000);
    if (this.maxQueuedSamples < 1) {
      throw new Error('PCM queue duration limit is smaller than one sample frame');
    }
  }

  public enqueue(block: Readonly<Float32Array>): void {
    if (block.length === 0 || block.length % this.channels !== 0) {
      throw new Error('PCM block does not contain complete interleaved frames');
    }
    if (!block.every((sample) => Number.isFinite(sample))) {
      throw new Error('PCM block contains a non-finite sample');
    }
    const sampleCount = block.length / this.channels;
    if (this.queuedSamples + sampleCount > this.maxQueuedSamples) {
      throw new Error('PCM queue duration limit exceeded');
    }
    this.blocks.push(block.slice());
    this.queuedSamples += sampleCount;
  }

  public read(outputs: ReadonlyArray<Float32Array>, allowTerminalSilence = false): void {
    if (outputs.length !== this.channels) {
      throw new Error('PCM output channel count mismatch');
    }
    const frameCount = outputs[0]?.length ?? 0;
    if (outputs.some((output) => output.length !== frameCount)) {
      throw new Error('PCM output frame lengths mismatch');
    }
    outputs.forEach((output) => output.fill(0));

    let written = 0;
    while (written < frameCount) {
      const block = this.blocks[0];
      if (block === undefined) {
        break;
      }
      const available = block.length / this.channels - this.currentBlockOffset;
      const copyCount = Math.min(frameCount - written, available);
      for (let frame = 0; frame < copyCount; frame += 1) {
        for (let channel = 0; channel < this.channels; channel += 1) {
          const output = outputs[channel];
          if (output !== undefined) {
            output[written + frame] = block[
              (this.currentBlockOffset + frame) * this.channels + channel
            ] ?? 0;
          }
        }
      }
      written += copyCount;
      this.currentBlockOffset += copyCount;
      if (this.currentBlockOffset === block.length / this.channels) {
        this.blocks.shift();
        this.currentBlockOffset = 0;
      }
    }
    if (written < frameCount && !allowTerminalSilence) {
      this.underruns += 1;
    }
    this.queuedSamples -= written;
  }

  public queuedAudioMs(): number {
    return this.queuedSampleCount() * 1000 / this.sampleRate;
  }

  public underrunCount(): number {
    return this.underruns;
  }

  public reset(): void {
    this.blocks.length = 0;
    this.currentBlockOffset = 0;
    this.queuedSamples = 0;
    this.underruns = 0;
  }

  private queuedSampleCount(): number {
    return this.queuedSamples;
  }
}
