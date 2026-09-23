// pattern: Imperative Shell

import {
  HRTF_ASSET_VERSION,
  HRTF_PRESET_OPTIONS,
  hrtfAssetMetadata,
  type HrtfPreset,
} from './hrtf-presets.js';

export const HRTF_ASSET_CACHE_NAME = 'openjoc-hrtf-assets-v2';
const CACHE_KEY_ORIGIN = 'https://openjoc-cache.invalid/';
const RETIRED_HRTF_ASSET_CACHE_KEYS: ReadonlyArray<string> = [
  new URL(
    'openjoc-hrtf-v2.0.0/aachen-high-resolution-kemar/2cc2f2d93194be681d4e446d66b4007060bc6c768cf7026c92e5efb87cf06dc3',
    CACHE_KEY_ORIGIN,
  ).href,
  new URL(
    'openjoc-hrtf-v2.0.0/sadie-ii-d2-kemar/b2f42ca2ce9ef2dfa7e3eff263543c4f306d0ac95bd684cf5ca344c88d6bd461',
    CACHE_KEY_ORIGIN,
  ).href,
];

export type HrtfAssetLoadStage =
  | 'verifying'
  | 'preparing';

export type HrtfManifestAsset = Readonly<{
  readonly presetId: HrtfPreset;
  readonly assetVersion: string;
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly dataset: string;
  readonly source: string;
  readonly authorsInstitution: string;
  readonly doi: string | null;
  readonly license: string;
  readonly sampleRateHz: number;
  readonly directionCount: number;
  readonly tapCount: number;
  readonly notes: string;
}>;

export type HrtfManifest = Readonly<{
  readonly schemaVersion: 1;
  readonly assetVersion: string;
  readonly packageKind: 'standard';
  readonly bundledPresets: ReadonlyArray<HrtfPreset>;
  readonly assets: Readonly<Record<HrtfPreset, HrtfManifestAsset>>;
}>;

export type HrtfAssetLoadOptions = Readonly<{
  readonly descriptor: HrtfManifestAsset;
  readonly wasmUrl: URL;
  readonly fetcher: typeof fetch;
  readonly signal: AbortSignal;
  readonly onStage?: (stage: HrtfAssetLoadStage) => void;
}>;

export type HrtfManifestLoadOptions = Readonly<{
  readonly wasmUrl: URL;
  readonly fetcher: typeof fetch;
  readonly signal: AbortSignal;
}>;

/** Validates the locally packaged manifest against the compiled-in preset registry. */
export function validateHrtfManifest(value: unknown): HrtfManifest {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.assetVersion !== HRTF_ASSET_VERSION
    || value.packageKind !== 'standard'
    || !isRecord(value.assets)
    || !Array.isArray(value.bundledPresets)) {
    throw new Error('invalid built-in HRTF manifest header');
  }

  const knownPresets = HRTF_PRESET_OPTIONS.map((option) => option.id);
  const candidatePresets: ReadonlyArray<unknown> = value.bundledPresets;
  const bundledPresets: Array<HrtfPreset> = [];
  for (const preset of candidatePresets) {
    if (!isHrtfPreset(preset)) throw new Error('built-in HRTF manifest contains an unknown preset');
    bundledPresets.push(preset);
  }
  if (new Set(bundledPresets).size !== bundledPresets.length
    || bundledPresets.length !== knownPresets.length
    || !knownPresets.every((preset) => bundledPresets.includes(preset))) {
    throw new Error('built-in HRTF manifest must bundle every supported preset');
  }
  if (Object.keys(value.assets).length !== knownPresets.length) {
    throw new Error('built-in HRTF manifest does not match the compiled preset count');
  }

  const sadieD1 = parseManifestAsset(value.assets, 'sadie-ii-d1-ku100');
  const sadieD2 = parseManifestAsset(value.assets, 'sadie-ii-d2-kemar');
  return {
    schemaVersion: 1,
    assetVersion: HRTF_ASSET_VERSION,
    packageKind: value.packageKind,
    bundledPresets,
    assets: {
      'sadie-ii-d1-ku100': sadieD1,
      'sadie-ii-d2-kemar': sadieD2,
    },
  };
}

/** Loads only the small, extension-packaged manifest; asset URLs never come from the network. */
export async function loadHrtfManifest(options: HrtfManifestLoadOptions): Promise<HrtfManifest> {
  const url = new URL('./hrtf/manifest.json', options.wasmUrl);
  const response = await options.fetcher(url, {signal: options.signal});
  if (!response.ok) throw new Error(`failed to load the built-in HRTF manifest: ${response.status}`);
  const value: unknown = await response.json();
  return validateHrtfManifest(value);
}

/** Loads one packaged .ojhrtf asset and verifies it before renderer initialization. */
export async function fetchHrtfAsset(options: HrtfAssetLoadOptions): Promise<Uint8Array> {
  const {descriptor, wasmUrl, fetcher, signal, onStage} = options;
  const assetUrl = new URL(`./hrtf/${descriptor.fileName}`, wasmUrl);
  let response: Response;
  try {
    response = await fetcher(assetUrl, {signal});
  } catch (error: unknown) {
    if (signal.aborted) throw error;
    throw new Error(`failed to load built-in HRTF ${descriptor.presetId}; reinstall the extension and retry`, {cause: error});
  }
  if (!response.ok) {
    const hint = response.status === 404 ? 'the packaged asset is missing' : `HTTP ${response.status}`;
    throw new Error(`failed to load built-in HRTF ${descriptor.presetId}: ${hint}; reinstall the extension and retry`);
  }
  onStage?.('verifying');
  const bytes = await readAndVerifyHrtfAsset(response, descriptor, signal);
  if (bytes === null) {
    throw new Error(`built-in HRTF ${descriptor.presetId} failed size or SHA-256 verification`);
  }
  onStage?.('preparing');
  return bytes;
}

/** Removes old downloaded assets that are now bundled, preserving unrelated cache entries. */
export async function clearRetiredHrtfAssetCache(cache: Pick<Cache, 'delete'>): Promise<number> {
  let removed = 0;
  for (const request of RETIRED_HRTF_ASSET_CACHE_KEYS) {
    if (await cache.delete(request)) removed += 1;
  }
  return removed;
}

function parseManifestAsset(
  assets: Record<string, unknown>,
  preset: HrtfPreset,
): HrtfManifestAsset {
  if (!Object.hasOwn(assets, preset)) throw new Error(`built-in HRTF manifest is missing ${preset}`);
  const value = assets[preset];
  if (!isRecord(value)) throw new Error(`invalid built-in HRTF manifest entry: ${preset}`);
  const expected = hrtfAssetMetadata(preset);
  if (value.presetId !== preset
    || value.assetVersion !== HRTF_ASSET_VERSION
    || value.fileName !== expected.fileName
    || value.byteLength !== expected.byteLength
    || value.sha256 !== expected.sha256
    || typeof value.dataset !== 'string'
    || typeof value.source !== 'string'
    || typeof value.authorsInstitution !== 'string'
    || (value.doi !== null && typeof value.doi !== 'string')
    || typeof value.license !== 'string'
    || !isPositiveInteger(value.sampleRateHz)
    || !isPositiveInteger(value.directionCount)
    || !isPositiveInteger(value.tapCount)
    || typeof value.notes !== 'string'
    || value.dataset.length === 0
    || value.source.length === 0
    || value.authorsInstitution.length === 0
    || value.license.length === 0) {
    throw new Error(`invalid or mismatched built-in HRTF manifest entry: ${preset}`);
  }
  return {
    presetId: preset,
    assetVersion: HRTF_ASSET_VERSION,
    fileName: expected.fileName,
    byteLength: expected.byteLength,
    sha256: expected.sha256,
    dataset: value.dataset,
    source: value.source,
    authorsInstitution: value.authorsInstitution,
    doi: value.doi,
    license: value.license,
    sampleRateHz: value.sampleRateHz,
    directionCount: value.directionCount,
    tapCount: value.tapCount,
    notes: value.notes,
  };
}

async function readAndVerifyHrtfAsset(
  response: Response,
  descriptor: HrtfManifestAsset,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > descriptor.byteLength) {
    await response.body?.cancel();
    return null;
  }
  if (response.body === null) return null;

  // The manifest is locally pinned, so this is a strict upper bound. Stream
  // chunks directly into the single final asset buffer and abort before an
  // oversized or chunked response can grow an unbounded ArrayBuffer.
  const bytes = new Uint8Array(descriptor.byteLength);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new DOMException('HRTF load canceled', 'AbortError');
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength > descriptor.byteLength - offset) {
        await reader.cancel();
        return null;
      }
      bytes.set(chunk.value, offset);
      offset += chunk.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== descriptor.byteLength) return null;
  if (signal.aborted) throw signal.reason ?? new DOMException('HRTF load canceled', 'AbortError');
  // This buffer was allocated locally at the fixed manifest length; hashing
  // it directly avoids an additional full asset copy in the worker.
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  if (signal.aborted) throw signal.reason ?? new DOMException('HRTF load canceled', 'AbortError');
  const actualHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  return actualHash === descriptor.sha256 ? bytes : null;
}

function isHrtfPreset(value: unknown): value is HrtfPreset {
  return HRTF_PRESET_OPTIONS.some((option) => option.id === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
