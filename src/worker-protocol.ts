// pattern: Functional Core

export const MAX_INPUT_FILE_BYTES = 128 * 1024 * 1024;

export type WorkerCommand =
  | Readonly<{type: 'decode'; generation: number; bytes: ArrayBuffer}>
  | Readonly<{type: 'pause'; generation: number}>
  | Readonly<{type: 'resume'; generation: number}>
  | Readonly<{type: 'reset'; generation: number}>
  | Readonly<{type: 'queue-stats'; generation: number; queuedAudioMs: number; acceptedSequence: number}>;

export type DecoderWorkerStatus = Readonly<{
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

export type WorkerMessage =
  | Readonly<{type: 'pcm'; generation: number; sequence: number; buffer: ArrayBuffer; samples: number}>
  | Readonly<{type: 'decoder-status'; generation: number; status: DecoderWorkerStatus}>
  | Readonly<{type: 'decode-complete'; generation: number}>
  | Readonly<{type: 'error'; generation: number; message: string; category: string | null; detail: string | null}>;
