// pattern: Imperative Shell

import {canStartDecode, isCurrentGeneration} from './generation.js';

export type DecoderLoader<DecoderType> = () => Promise<DecoderType>;
export type DecoderDestroyer<DecoderType> = (decoder: DecoderType) => void;
export type DecoderResetter<DecoderType> = (decoder: DecoderType) => void;

/** Owns decoder replacement so an old asynchronous load cannot clear a newer generation. */
export class DecoderGenerationSlot<DecoderType> {
  private currentGeneration = 0;
  private activeGeneration: number | null = null;
  private decoder: DecoderType | null = null;

  public constructor(
    private readonly load: DecoderLoader<DecoderType>,
    private readonly destroy: DecoderDestroyer<DecoderType>,
  ) {}

  public async start(requestedGeneration: number): Promise<DecoderType | null> {
    if (!canStartDecode(this.currentGeneration, this.activeGeneration, requestedGeneration)) {
      return null;
    }
    this.currentGeneration = requestedGeneration;
    this.activeGeneration = requestedGeneration;
    if (this.decoder !== null) {
      this.destroy(this.decoder);
      this.decoder = null;
    }
    const loadedDecoder = await this.load();
    if (!isCurrentGeneration(requestedGeneration, this.currentGeneration) || this.activeGeneration !== requestedGeneration) {
      this.destroy(loadedDecoder);
      return null;
    }
    this.decoder = loadedDecoder;
    return loadedDecoder;
  }

  public current(): DecoderType | null {
    return this.decoder;
  }

  public finish(generation: number): void {
    if (this.activeGeneration === generation) {
      this.activeGeneration = null;
    }
  }

  public reset(generation: number, resetDecoder: DecoderResetter<DecoderType>): void {
    if (generation < this.currentGeneration) {
      return;
    }
    this.currentGeneration = generation;
    this.activeGeneration = null;
    if (this.decoder !== null) {
      resetDecoder(this.decoder);
    }
  }
}
