// pattern: Imperative Shell

import {DEFAULT_HRTF_PRESET, type HrtfPreset} from './hrtf-presets.js';
import {
  HRTF_ASSET_CACHE_NAME,
  fetchHrtfAsset,
  loadHrtfManifest,
  type HrtfAssetLoadStage,
} from './hrtf-assets.js';

export type WasmDecoderStatus = 0 | 1 | 2 | 3 | -1;

export type WasmDecoderSnapshot = Readonly<{
  readonly renderer: 'stereo' | 'binaural';
  readonly virtualLayout: '7.1.4' | null;
  readonly hrtf: HrtfPreset | null;
  readonly latencySamples: number;
  readonly sampleRate: number | null;
  readonly outputChannels: number;
  readonly queuedAudioMs: number;
  readonly underrunCount: number;
  readonly prerollMs: number;
  readonly decodedAccessUnits: number;
  readonly outputFrames: number;
  readonly outputSamples: number;
  readonly decodeMeanMs: number;
  readonly decodeP95Ms: number;
  readonly decodeMaxMs: number;
  readonly renderMeanMs: number;
  readonly renderP95Ms: number;
  readonly renderMaxMs: number;
  readonly binauralMeanMs: number;
  readonly binauralP95Ms: number;
  readonly binauralMaxMs: number;
  readonly totalMeanMs: number;
  readonly totalP95Ms: number;
  readonly totalMaxMs: number;
  readonly realtimeFactor: number | null;
  readonly wasmMemoryBytes: number;
  readonly wasmMemoryPeakBytes: number;
  readonly wasmMemoryGrowthBytes: number;
  readonly profile: string | null;
  readonly downmixIndex: number | null;
  readonly objectCount: number | null;
  readonly complexityIndex: number | null;
  readonly nativeDolbyDecoderUsed: false;
  readonly errorCategory: string | null;
  readonly errorDetail: string | null;
}>;

type WasmNumberFunction = (...arguments_: Array<number>) => number;
type WasmNumericFunction = (...arguments_: Array<number>) => number | bigint;
type WasmPacketFunction = (handle: number, pointer: number, length: number, ptsSamples: bigint, flags: number) => number;

const NO_PTS_SAMPLES = -9_223_372_036_854_775_808n;

function optionalFunction(exports_: WebAssembly.Exports, name: string): WasmNumberFunction | undefined {
  const value = exports_[name];
  return typeof value === 'function' ? value as WasmNumberFunction : undefined;
}

export type WasmPcmBlock = Readonly<{
  readonly samples: Float32Array;
  readonly ptsSamples: number | null;
}>;

export type WasmPacketOptions = Readonly<{
  readonly ptsSamples: number | null;
  readonly discontinuity: boolean;
  readonly preroll: boolean;
}>;

export type WasmDecoderOptions = Readonly<{
  readonly dialnormMode?: 'calibrated' | 'unity';
  readonly renderer?: 'stereo' | 'binaural';
  readonly hrtf?: HrtfPreset;
  readonly hrtfAsset?: Uint8Array;
}>;

export type WasmAssetLoadOptions = Readonly<{
  readonly signal?: AbortSignal;
  readonly onHrtfLoadStage?: (stage: HrtfAssetLoadStage) => void;
}>;

type WasmExports = Readonly<{
  readonly memory: WebAssembly.Memory;
  readonly openjoc_wasm_alloc: WasmNumberFunction;
  readonly openjoc_wasm_dealloc: WasmNumberFunction;
  readonly openjoc_wasm_decoder_create: WasmNumberFunction;
  readonly openjoc_wasm_decoder_create_with_dialnorm: WasmNumberFunction;
  readonly openjoc_wasm_decoder_create_with_renderer: WasmNumberFunction;
  readonly openjoc_wasm_decoder_create_with_renderer_and_hrtf?: WasmNumberFunction;
  readonly openjoc_wasm_hrtf_asset_alloc?: WasmNumberFunction;
  readonly openjoc_wasm_decoder_create_with_renderer_and_hrtf_asset?: WasmNumberFunction;
  readonly openjoc_wasm_decoder_destroy: WasmNumberFunction;
  readonly openjoc_wasm_decoder_push_bytes: WasmNumberFunction;
  readonly openjoc_wasm_decoder_push_packet: WasmPacketFunction;
  readonly openjoc_wasm_decoder_flush: WasmNumberFunction;
  readonly openjoc_wasm_decoder_reset: WasmNumberFunction;
  readonly openjoc_wasm_decoder_receive_pcm: WasmNumberFunction;
  readonly openjoc_wasm_decoder_consume_pcm: WasmNumberFunction;
  readonly openjoc_wasm_decoder_pcm_ptr: WasmNumberFunction;
  readonly openjoc_wasm_decoder_pcm_len: WasmNumberFunction;
  readonly openjoc_wasm_decoder_pcm_samples: WasmNumberFunction;
  readonly openjoc_wasm_decoder_pcm_pts_samples: (handle: number) => bigint;
  readonly openjoc_wasm_decoder_sample_rate: WasmNumberFunction;
  readonly openjoc_wasm_decoder_channel_count: WasmNumberFunction;
  readonly openjoc_wasm_decoder_renderer: WasmNumberFunction;
  readonly openjoc_wasm_decoder_latency_samples: WasmNumberFunction;
  readonly openjoc_wasm_decoder_queued_audio_ms: WasmNumberFunction;
  readonly openjoc_wasm_decoder_decoded_access_units: WasmNumberFunction;
  readonly openjoc_wasm_decoder_output_frames: WasmNumberFunction;
  readonly openjoc_wasm_decoder_output_samples: WasmNumericFunction;
  readonly openjoc_wasm_decoder_decode_mean_ms: WasmNumberFunction;
  readonly openjoc_wasm_decoder_decode_p95_ms: WasmNumberFunction;
  readonly openjoc_wasm_decoder_decode_max_ms: WasmNumberFunction;
  readonly openjoc_wasm_decoder_render_mean_ms: WasmNumberFunction;
  readonly openjoc_wasm_decoder_render_p95_ms: WasmNumberFunction;
  readonly openjoc_wasm_decoder_render_max_ms: WasmNumberFunction;
  readonly openjoc_wasm_decoder_binaural_mean_ms: WasmNumberFunction;
  readonly openjoc_wasm_decoder_binaural_p95_ms: WasmNumberFunction;
  readonly openjoc_wasm_decoder_binaural_max_ms: WasmNumberFunction;
  readonly openjoc_wasm_decoder_total_mean_ms: WasmNumberFunction;
  readonly openjoc_wasm_decoder_total_p95_ms: WasmNumberFunction;
  readonly openjoc_wasm_decoder_total_max_ms: WasmNumberFunction;
  readonly openjoc_wasm_decoder_realtime_factor: WasmNumberFunction;
  readonly openjoc_wasm_decoder_error_ptr: WasmNumberFunction;
  readonly openjoc_wasm_decoder_error_len: WasmNumberFunction;
  readonly openjoc_wasm_decoder_error_category: WasmNumberFunction;
  readonly openjoc_wasm_decoder_profile_ptr: WasmNumberFunction;
  readonly openjoc_wasm_decoder_profile_len: WasmNumberFunction;
  readonly openjoc_wasm_decoder_downmix_index: WasmNumberFunction;
  readonly openjoc_wasm_decoder_object_count: WasmNumberFunction;
  readonly openjoc_wasm_decoder_complexity_index: WasmNumberFunction;
}>;

function requireMemory(exports_: WebAssembly.Exports): WebAssembly.Memory {
  const memory = exports_.memory;
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new Error('OpenJOC WASM memory export is missing');
  }
  return memory;
}

function requireFunction(
  exports_: WebAssembly.Exports,
  name: string,
): WasmNumberFunction {
  const value: unknown = exports_[name];
  if (typeof value !== 'function') {
    throw new Error(`OpenJOC WASM export is missing: ${name}`);
  }
  return value as WasmNumberFunction;
}

function requirePacketFunction(
  exports_: WebAssembly.Exports,
  name: string,
): WasmPacketFunction {
  const value = exports_[name];
  if (typeof value !== 'function') {
    throw new Error(`OpenJOC WASM export is missing: ${name}`);
  }
  // WebAssembly i64 parameters are exposed as bigint by the browser binding;
  // the generic numeric export validator cannot express that ABI distinction.
  return value as unknown as WasmPacketFunction;
}

function requirePtsFunction(
  exports_: WebAssembly.Exports,
  name: string,
): (handle: number) => bigint {
  const value = exports_[name];
  if (typeof value !== 'function') {
    throw new Error(`OpenJOC WASM export is missing: ${name}`);
  }
  // WebAssembly i64 results are exposed as bigint by the browser binding.
  return value as unknown as (handle: number) => bigint;
}

function createExports(instance: WebAssembly.Instance): WasmExports {
  const raw = instance.exports;
  return {
    memory: requireMemory(raw),
    openjoc_wasm_alloc: requireFunction(raw, 'openjoc_wasm_alloc'),
    openjoc_wasm_dealloc: requireFunction(raw, 'openjoc_wasm_dealloc'),
    openjoc_wasm_decoder_create: requireFunction(raw, 'openjoc_wasm_decoder_create'),
    openjoc_wasm_decoder_create_with_dialnorm: requireFunction(raw, 'openjoc_wasm_decoder_create_with_dialnorm'),
    openjoc_wasm_decoder_create_with_renderer: requireFunction(raw, 'openjoc_wasm_decoder_create_with_renderer'),
    openjoc_wasm_decoder_create_with_renderer_and_hrtf: optionalFunction(raw, 'openjoc_wasm_decoder_create_with_renderer_and_hrtf'),
    openjoc_wasm_hrtf_asset_alloc: optionalFunction(raw, 'openjoc_wasm_hrtf_asset_alloc'),
    openjoc_wasm_decoder_create_with_renderer_and_hrtf_asset: optionalFunction(raw, 'openjoc_wasm_decoder_create_with_renderer_and_hrtf_asset'),
    openjoc_wasm_decoder_destroy: requireFunction(raw, 'openjoc_wasm_decoder_destroy'),
    openjoc_wasm_decoder_push_bytes: requireFunction(raw, 'openjoc_wasm_decoder_push_bytes'),
    openjoc_wasm_decoder_push_packet: requirePacketFunction(raw, 'openjoc_wasm_decoder_push_packet'),
    openjoc_wasm_decoder_flush: requireFunction(raw, 'openjoc_wasm_decoder_flush'),
    openjoc_wasm_decoder_reset: requireFunction(raw, 'openjoc_wasm_decoder_reset'),
    openjoc_wasm_decoder_receive_pcm: requireFunction(raw, 'openjoc_wasm_decoder_receive_pcm'),
    openjoc_wasm_decoder_consume_pcm: requireFunction(raw, 'openjoc_wasm_decoder_consume_pcm'),
    openjoc_wasm_decoder_pcm_ptr: requireFunction(raw, 'openjoc_wasm_decoder_pcm_ptr'),
    openjoc_wasm_decoder_pcm_len: requireFunction(raw, 'openjoc_wasm_decoder_pcm_len'),
    openjoc_wasm_decoder_pcm_samples: requireFunction(raw, 'openjoc_wasm_decoder_pcm_samples'),
    openjoc_wasm_decoder_pcm_pts_samples: requirePtsFunction(raw, 'openjoc_wasm_decoder_pcm_pts_samples'),
    openjoc_wasm_decoder_sample_rate: requireFunction(raw, 'openjoc_wasm_decoder_sample_rate'),
    openjoc_wasm_decoder_channel_count: requireFunction(raw, 'openjoc_wasm_decoder_channel_count'),
    openjoc_wasm_decoder_renderer: requireFunction(raw, 'openjoc_wasm_decoder_renderer'),
    openjoc_wasm_decoder_latency_samples: requireFunction(raw, 'openjoc_wasm_decoder_latency_samples'),
    openjoc_wasm_decoder_queued_audio_ms: requireFunction(raw, 'openjoc_wasm_decoder_queued_audio_ms'),
    openjoc_wasm_decoder_decoded_access_units: requireFunction(raw, 'openjoc_wasm_decoder_decoded_access_units'),
    openjoc_wasm_decoder_output_frames: requireFunction(raw, 'openjoc_wasm_decoder_output_frames'),
    openjoc_wasm_decoder_output_samples: requireFunction(raw, 'openjoc_wasm_decoder_output_samples'),
    openjoc_wasm_decoder_decode_mean_ms: requireFunction(raw, 'openjoc_wasm_decoder_decode_mean_ms'),
    openjoc_wasm_decoder_decode_p95_ms: requireFunction(raw, 'openjoc_wasm_decoder_decode_p95_ms'),
    openjoc_wasm_decoder_decode_max_ms: requireFunction(raw, 'openjoc_wasm_decoder_decode_max_ms'),
    openjoc_wasm_decoder_render_mean_ms: requireFunction(raw, 'openjoc_wasm_decoder_render_mean_ms'),
    openjoc_wasm_decoder_render_p95_ms: requireFunction(raw, 'openjoc_wasm_decoder_render_p95_ms'),
    openjoc_wasm_decoder_render_max_ms: requireFunction(raw, 'openjoc_wasm_decoder_render_max_ms'),
    openjoc_wasm_decoder_binaural_mean_ms: requireFunction(raw, 'openjoc_wasm_decoder_binaural_mean_ms'),
    openjoc_wasm_decoder_binaural_p95_ms: requireFunction(raw, 'openjoc_wasm_decoder_binaural_p95_ms'),
    openjoc_wasm_decoder_binaural_max_ms: requireFunction(raw, 'openjoc_wasm_decoder_binaural_max_ms'),
    openjoc_wasm_decoder_total_mean_ms: requireFunction(raw, 'openjoc_wasm_decoder_total_mean_ms'),
    openjoc_wasm_decoder_total_p95_ms: requireFunction(raw, 'openjoc_wasm_decoder_total_p95_ms'),
    openjoc_wasm_decoder_total_max_ms: requireFunction(raw, 'openjoc_wasm_decoder_total_max_ms'),
    openjoc_wasm_decoder_realtime_factor: requireFunction(raw, 'openjoc_wasm_decoder_realtime_factor'),
    openjoc_wasm_decoder_error_ptr: requireFunction(raw, 'openjoc_wasm_decoder_error_ptr'),
    openjoc_wasm_decoder_error_len: requireFunction(raw, 'openjoc_wasm_decoder_error_len'),
    openjoc_wasm_decoder_error_category: requireFunction(raw, 'openjoc_wasm_decoder_error_category'),
    openjoc_wasm_decoder_profile_ptr: requireFunction(raw, 'openjoc_wasm_decoder_profile_ptr'),
    openjoc_wasm_decoder_profile_len: requireFunction(raw, 'openjoc_wasm_decoder_profile_len'),
    openjoc_wasm_decoder_downmix_index: requireFunction(raw, 'openjoc_wasm_decoder_downmix_index'),
    openjoc_wasm_decoder_object_count: requireFunction(raw, 'openjoc_wasm_decoder_object_count'),
    openjoc_wasm_decoder_complexity_index: requireFunction(raw, 'openjoc_wasm_decoder_complexity_index'),
  };
}

export class WasmDecoderClient {
  private readonly exports_: WasmExports;
  private readonly handle: number;
  private readonly hrtfPreset: HrtfPreset;
  private readonly decoderText = new TextDecoder();
  private readonly initialMemoryBytes: number;
  private peakMemoryBytes: number;
  private isDestroyed = false;

  public constructor(instance: WebAssembly.Instance, options: WasmDecoderOptions = {}) {
    this.exports_ = createExports(instance);
    const mode = options.dialnormMode === 'unity' ? 1 : 0;
    const renderer = options.renderer === 'binaural' ? 1 : 0;
    const hrtf = options.hrtf ?? DEFAULT_HRTF_PRESET;
    const hrtfCode = hrtf === 'sadie-ii-d2-kemar' ? 1 : hrtf === 'aachen-high-resolution-kemar' ? 2 : 0;
    this.hrtfPreset = hrtf;
    const createWithHrtf = this.exports_.openjoc_wasm_decoder_create_with_renderer_and_hrtf;
    const createWithHrtfAsset = this.exports_.openjoc_wasm_decoder_create_with_renderer_and_hrtf_asset;
    if (renderer === 1 && createWithHrtfAsset !== undefined) {
      const asset = options.hrtfAsset;
      const allocate = this.exports_.openjoc_wasm_hrtf_asset_alloc;
      if (asset === undefined || allocate === undefined) {
        throw new Error('selected built-in HRTF asset is missing from the decoder request');
      }
      const pointer = allocate(asset.length);
      if (pointer === 0) throw new Error('failed to allocate OpenJOC HRTF asset buffer');
      try {
        this.writeBytes(pointer, asset);
        this.handle = createWithHrtfAsset(mode, renderer, hrtfCode, pointer, asset.length);
      } finally {
        this.exports_.openjoc_wasm_dealloc(pointer, asset.length);
      }
    } else if (options.hrtfAsset !== undefined) {
      throw new Error('this OpenJOC WASM bridge does not support external HRTF assets');
    } else if (createWithHrtf === undefined && hrtf !== DEFAULT_HRTF_PRESET) {
      throw new Error('selected built-in HRTF requires an updated OpenJOC WASM bridge');
    } else {
      this.handle = createWithHrtf === undefined
        ? this.exports_.openjoc_wasm_decoder_create_with_renderer(mode, renderer)
        : createWithHrtf(mode, renderer, hrtfCode);
    }
    if (this.handle === 0) {
      throw new Error('failed to create OpenJOC WASM decoder');
    }
    this.initialMemoryBytes = this.exports_.memory.buffer.byteLength;
    this.peakMemoryBytes = this.initialMemoryBytes;
  }

  public pushBytes(bytes: Readonly<Uint8Array>): WasmDecoderStatus {
    this.assertAlive();
    if (bytes.length === 0) {
      const status = this.statusCode(this.exports_.openjoc_wasm_decoder_push_bytes(this.handle, 0, 0));
      this.recordMemory();
      return status;
    }
    const pointer = this.exports_.openjoc_wasm_alloc(bytes.length);
    if (pointer === 0) {
      throw new Error('failed to allocate OpenJOC WASM input buffer');
    }
    try {
      this.writeBytes(pointer, bytes);
      const status = this.statusCode(this.exports_.openjoc_wasm_decoder_push_bytes(
        this.handle,
        pointer,
        bytes.length,
      ));
      this.recordMemory();
      return status;
    } finally {
      this.exports_.openjoc_wasm_dealloc(pointer, bytes.length);
    }
  }

  public pushPacket(bytes: Readonly<Uint8Array>, options: WasmPacketOptions): WasmDecoderStatus {
    this.assertAlive();
    if (bytes.length === 0) {
      throw new Error('cannot push an empty OpenJOC CMAF packet');
    }
    const pointer = this.exports_.openjoc_wasm_alloc(bytes.length);
    if (pointer === 0) {
      throw new Error('failed to allocate OpenJOC WASM packet buffer');
    }
    const flags = (options.discontinuity ? 1 : 0) | (options.preroll ? 2 : 0);
    const ptsSamples = options.ptsSamples === null ? NO_PTS_SAMPLES : BigInt(options.ptsSamples);
    try {
      this.writeBytes(pointer, bytes);
      const status = this.statusCode(this.exports_.openjoc_wasm_decoder_push_packet(
        this.handle,
        pointer,
        bytes.length,
        ptsSamples,
        flags,
      ));
      this.recordMemory();
      return status;
    } finally {
      this.exports_.openjoc_wasm_dealloc(pointer, bytes.length);
    }
  }

  public flush(): WasmDecoderStatus {
    this.assertAlive();
    const status = this.statusCode(this.exports_.openjoc_wasm_decoder_flush(this.handle));
    this.recordMemory();
    return status;
  }

  public receivePcm(): WasmPcmBlock | null {
    this.assertAlive();
    if (this.exports_.openjoc_wasm_decoder_receive_pcm(this.handle) !== 1) {
      return null;
    }
    const pointer = this.exports_.openjoc_wasm_decoder_pcm_ptr(this.handle);
    const length = this.exports_.openjoc_wasm_decoder_pcm_len(this.handle);
    if (pointer === 0 || length === 0 || length % 2 !== 0) {
      this.exports_.openjoc_wasm_decoder_consume_pcm(this.handle);
      throw new Error('OpenJOC WASM returned an invalid PCM buffer');
    }
    this.assertMemoryRange(pointer, length * Float32Array.BYTES_PER_ELEMENT);
    const output = new Float32Array(length);
    output.set(new Float32Array(this.exports_.memory.buffer, pointer, length));
    const pts = this.exports_.openjoc_wasm_decoder_pcm_pts_samples(this.handle);
    if (this.exports_.openjoc_wasm_decoder_consume_pcm(this.handle) !== 1) {
      throw new Error('OpenJOC WASM failed to consume its PCM buffer');
    }
    return {samples: output, ptsSamples: pts === NO_PTS_SAMPLES ? null : Number(pts)};
  }

  public status(): WasmDecoderSnapshot {
    this.assertAlive();
    this.recordMemory();
    const renderer = this.exports_.openjoc_wasm_decoder_renderer(this.handle);
    if (renderer !== 0 && renderer !== 1) {
      throw new Error(`unknown OpenJOC WASM renderer: ${renderer}`);
    }
    return {
      renderer: renderer === 1 ? 'binaural' : 'stereo',
      virtualLayout: renderer === 1 ? '7.1.4' : null,
      hrtf: renderer === 1 ? (this.hrtfPreset ?? DEFAULT_HRTF_PRESET) : null,
      latencySamples: this.exports_.openjoc_wasm_decoder_latency_samples(this.handle),
      sampleRate: this.optionalSampleRate(this.exports_.openjoc_wasm_decoder_sample_rate(this.handle)),
      outputChannels: this.exports_.openjoc_wasm_decoder_channel_count(this.handle),
      queuedAudioMs: this.exports_.openjoc_wasm_decoder_queued_audio_ms(this.handle),
      underrunCount: 0,
      prerollMs: 128,
      decodedAccessUnits: this.exports_.openjoc_wasm_decoder_decoded_access_units(this.handle),
      outputFrames: this.exports_.openjoc_wasm_decoder_output_frames(this.handle),
      outputSamples: Number(this.exports_.openjoc_wasm_decoder_output_samples(this.handle)),
      decodeMeanMs: this.exports_.openjoc_wasm_decoder_decode_mean_ms(this.handle),
      decodeP95Ms: this.exports_.openjoc_wasm_decoder_decode_p95_ms(this.handle),
      decodeMaxMs: this.exports_.openjoc_wasm_decoder_decode_max_ms(this.handle),
      renderMeanMs: this.exports_.openjoc_wasm_decoder_render_mean_ms(this.handle),
      renderP95Ms: this.exports_.openjoc_wasm_decoder_render_p95_ms(this.handle),
      renderMaxMs: this.exports_.openjoc_wasm_decoder_render_max_ms(this.handle),
      binauralMeanMs: this.exports_.openjoc_wasm_decoder_binaural_mean_ms(this.handle),
      binauralP95Ms: this.exports_.openjoc_wasm_decoder_binaural_p95_ms(this.handle),
      binauralMaxMs: this.exports_.openjoc_wasm_decoder_binaural_max_ms(this.handle),
      totalMeanMs: this.exports_.openjoc_wasm_decoder_total_mean_ms(this.handle),
      totalP95Ms: this.exports_.openjoc_wasm_decoder_total_p95_ms(this.handle),
      totalMaxMs: this.exports_.openjoc_wasm_decoder_total_max_ms(this.handle),
      realtimeFactor: this.optionalPerformance(this.exports_.openjoc_wasm_decoder_realtime_factor(this.handle)),
      profile: this.readText(
        this.exports_.openjoc_wasm_decoder_profile_ptr(this.handle),
        this.exports_.openjoc_wasm_decoder_profile_len(this.handle),
      ),
      downmixIndex: this.optionalUint(this.exports_.openjoc_wasm_decoder_downmix_index(this.handle)),
      objectCount: this.optionalUint(this.exports_.openjoc_wasm_decoder_object_count(this.handle)),
      complexityIndex: this.optionalUint(this.exports_.openjoc_wasm_decoder_complexity_index(this.handle)),
      nativeDolbyDecoderUsed: false,
      errorCategory: this.readErrorCategory(),
      errorDetail: this.errorDetail(),
      wasmMemoryBytes: this.exports_.memory.buffer.byteLength,
      wasmMemoryPeakBytes: this.peakMemoryBytes,
      wasmMemoryGrowthBytes: this.peakMemoryBytes - this.initialMemoryBytes,
    };
  }

  public errorDetail(): string | null {
    this.assertAlive();
    return this.readText(
      this.exports_.openjoc_wasm_decoder_error_ptr(this.handle),
      this.exports_.openjoc_wasm_decoder_error_len(this.handle),
    );
  }

  private readErrorCategory(): string | null {
    const value = this.exports_.openjoc_wasm_decoder_error_category(this.handle);
    if (value === -1 || value === 0xffff_ffff) {
      return null;
    }
    const categories = ['invalid_input', 'decode', 'render', 'lifecycle', 'internal'];
    return categories[value] ?? 'internal';
  }

  public reset(): void {
    this.assertAlive();
    if (this.exports_.openjoc_wasm_decoder_reset(this.handle) !== 0) {
      throw new Error('failed to reset OpenJOC WASM decoder');
    }
  }

  public destroy(): void {
    if (!this.isDestroyed) {
      this.exports_.openjoc_wasm_decoder_destroy(this.handle);
      this.isDestroyed = true;
    }
  }

  private statusCode(value: number): WasmDecoderStatus {
    if (value === 0 || value === 1 || value === 2 || value === 3 || value === -1) {
      return value;
    }
    throw new Error(`unknown OpenJOC WASM status: ${value}`);
  }

  private recordMemory(): number {
    const currentBytes = this.exports_.memory.buffer.byteLength;
    this.peakMemoryBytes = Math.max(this.peakMemoryBytes, currentBytes);
    return currentBytes;
  }

  private optionalUint(value: number): number | null {
    return value === -1 || value === 0xffff_ffff ? null : value;
  }

  private optionalSampleRate(value: number): number | null {
    return value === 0 ? null : value;
  }

  private optionalPerformance(value: number): number | null {
    return value > 0 && Number.isFinite(value) ? value : null;
  }

  private readText(pointer: number, length: number): string | null {
    if (pointer === 0 || length === 0) {
      return null;
    }
    this.assertMemoryRange(pointer, length);
    return this.decoderText.decode(new Uint8Array(this.exports_.memory.buffer, pointer, length));
  }

  private writeBytes(pointer: number, bytes: Readonly<Uint8Array>): void {
    this.assertMemoryRange(pointer, bytes.length);
    new Uint8Array(this.exports_.memory.buffer, pointer, bytes.length).set(bytes);
  }

  private assertMemoryRange(pointer: number, length: number): void {
    const end = pointer + length;
    if (!Number.isSafeInteger(pointer) || !Number.isSafeInteger(length) || end > this.exports_.memory.buffer.byteLength) {
      throw new Error('OpenJOC WASM memory range is invalid');
    }
  }

  private assertAlive(): void {
    if (this.isDestroyed) {
      throw new Error('OpenJOC WASM decoder has been destroyed');
    }
  }
}

export function supportsExternalHrtfAssetAbi(instance: WebAssembly.Instance): boolean {
  return typeof instance.exports.openjoc_wasm_decoder_create_with_renderer_and_hrtf_asset === 'function';
}

export async function loadOpenJocWasm(
  url: URL,
  options: WasmDecoderOptions = {},
  loadOptions: WasmAssetLoadOptions = {},
): Promise<WasmDecoderClient> {
  const renderer = options.renderer ?? 'stereo';
  const hrtf = options.hrtf ?? DEFAULT_HRTF_PRESET;
  const signal = loadOptions.signal ?? new AbortController().signal;
  // Keep WorkerGlobalScope as the receiver when fetch is passed to the asset loader.
  const workerFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);
  const response = await fetch(url, {signal});
  if (!response.ok) {
    throw new Error(`failed to load OpenJOC WASM: ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  const instantiated = await WebAssembly.instantiate(bytes, {
    env: {
      openjoc_wasm_clock_now_ms: (): number => performance.now(),
    },
  });
  // Embedded-resource WASM versions can keep using their own preset storage.
  const supportsExternalAssets = supportsExternalHrtfAssetAbi(instantiated.instance);
  let hrtfAsset: Uint8Array | undefined;
  if (renderer === 'binaural' && supportsExternalAssets) {
    const manifest = await loadHrtfManifest({wasmUrl: url, fetcher: workerFetch, signal});
    const descriptor = manifest.assets[hrtf];
    const bundled = manifest.bundledPresets.includes(hrtf);
    const cache = bundled || typeof globalThis.caches === 'undefined'
      ? null
      : await globalThis.caches.open(HRTF_ASSET_CACHE_NAME);
    hrtfAsset = await fetchHrtfAsset({
      descriptor,
      bundled,
      wasmUrl: url,
      fetcher: workerFetch,
      cache,
      signal,
      onStage: loadOptions.onHrtfLoadStage,
    });
  }
  return new WasmDecoderClient(instantiated.instance, {...options, hrtfAsset});
}
