// pattern: Imperative Shell

import {canStartDecode, isCurrentGeneration} from './generation.js';

export type DecoderLoader<DecoderType> = (signal: AbortSignal, generation: number) => Promise<DecoderType>;
export type DecoderDestroyer<DecoderType> = (decoder: DecoderType) => void;
export type DecoderResetter<DecoderType> = (decoder: DecoderType) => void;

/** Owns decoder replacement so an old asynchronous load cannot clear a newer generation. */
export class DecoderGenerationSlot<DecoderType> {
  private currentGeneration = 0;
  private activeGeneration: number | null = null;
  private decoder: DecoderType | null = null;
  private pendingLoad: AbortController | null = null;

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
    this.pendingLoad?.abort();
    const loadController = new AbortController();
    this.pendingLoad = loadController;
    const previousDecoder = this.decoder;
    let loadedDecoder: DecoderType;
    try {
      loadedDecoder = await this.load(loadController.signal, requestedGeneration);
    } catch (error: unknown) {
      if (this.pendingLoad === loadController) this.pendingLoad = null;
      throw error;
    }
    if (this.pendingLoad === loadController) this.pendingLoad = null;
    if (loadController.signal.aborted
      || !isCurrentGeneration(requestedGeneration, this.currentGeneration)
      || this.activeGeneration !== requestedGeneration) {
      this.destroy(loadedDecoder);
      return null;
    }
    this.decoder = loadedDecoder;
    if (previousDecoder !== null) {
      this.destroy(previousDecoder);
    }
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

  public cancelPendingLoad(): void {
    this.pendingLoad?.abort();
  }

  public reset(generation: number, resetDecoder: DecoderResetter<DecoderType>): void {
    if (generation < this.currentGeneration) {
      return;
    }
    this.currentGeneration = generation;
    this.activeGeneration = null;
    this.cancelPendingLoad();
    this.pendingLoad = null;
    if (this.decoder !== null) {
      resetDecoder(this.decoder);
    }
  }
}
