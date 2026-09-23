// pattern: Imperative Shell

import {
  HRTF_ASSET_VERSION,
  HRTF_PRESET_OPTIONS,
  hrtfAssetMetadata,
  type HrtfPreset,
} from './hrtf-presets.js';

export const HRTF_ASSET_CACHE_NAME = 'openjoc-hrtf-assets-v2';
const CACHE_KEY_ORIGIN = 'https://openjoc-cache.invalid/';
const HRTF_ASSET_CACHE_LOCKS = new Map<string, Promise<void>>();

export type HrtfAssetLoadStage =
  | 'available'
  | 'download-required'
  | 'downloading'
  | 'cached'
  | 'verifying'
  | 'preparing';

export type HrtfManifestAsset = Readonly<{
  readonly presetId: HrtfPreset;
  readonly assetVersion: string;
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly url: string;
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
  readonly packageKind: 'standard' | 'full';
  readonly baseUrl: string;
  readonly bundledPresets: ReadonlyArray<HrtfPreset>;
  readonly assets: Readonly<Record<HrtfPreset, HrtfManifestAsset>>;
}>;

export type HrtfAssetLoadOptions = Readonly<{
  readonly descriptor: HrtfManifestAsset;
  readonly bundled: boolean;
  readonly wasmUrl: URL;
  readonly fetcher: typeof fetch;
  readonly cache: Pick<Cache, 'match' | 'put' | 'delete'> | null;
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
    || (value.packageKind !== 'standard' && value.packageKind !== 'full')
    || typeof value.baseUrl !== 'string'
    || !isRecord(value.assets)
    || !Array.isArray(value.bundledPresets)) {
    throw new Error('invalid built-in HRTF manifest header');
  }

  const baseUrl = parseHttpsBaseUrl(value.baseUrl);
  const knownPresets = HRTF_PRESET_OPTIONS.map((option) => option.id);
  const candidatePresets: ReadonlyArray<unknown> = value.bundledPresets;
  const bundledPresets: Array<HrtfPreset> = [];
  for (const preset of candidatePresets) {
    if (!isHrtfPreset(preset)) throw new Error('built-in HRTF manifest contains an unknown preset');
    bundledPresets.push(preset);
  }
  if (new Set(bundledPresets).size !== bundledPresets.length
    || !bundledPresets.includes('sadie-ii-d1-ku100')
    || (value.packageKind === 'standard' && bundledPresets.length !== 1)
    || (value.packageKind === 'full' && bundledPresets.length !== knownPresets.length)) {
    throw new Error('built-in HRTF manifest has an invalid bundled preset set');
  }
  if (Object.keys(value.assets).length !== knownPresets.length) {
    throw new Error('built-in HRTF manifest does not match the compiled preset count');
  }

  const sadieD1 = parseManifestAsset(value.assets, 'sadie-ii-d1-ku100', baseUrl);
  const sadieD2 = parseManifestAsset(value.assets, 'sadie-ii-d2-kemar', baseUrl);
  const aachen = parseManifestAsset(value.assets, 'aachen-high-resolution-kemar', baseUrl);
  return {
    schemaVersion: 1,
    assetVersion: HRTF_ASSET_VERSION,
    packageKind: value.packageKind,
    baseUrl: baseUrl.href,
    bundledPresets,
    assets: {
      'sadie-ii-d1-ku100': sadieD1,
      'sadie-ii-d2-kemar': sadieD2,
      'aachen-high-resolution-kemar': aachen,
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

/** Returns a synthetic cache request bound to preset, asset version, and SHA-256. */
export function hrtfAssetCacheKey(asset: Pick<HrtfManifestAsset, 'presetId' | 'assetVersion' | 'sha256'>): string {
  return new URL(`${asset.assetVersion}/${asset.presetId}/${asset.sha256}`, CACHE_KEY_ORIGIN).href;
}

/** Fetches or reads one canonical .ojhrtf data asset, validating it before use. */
export function fetchHrtfAsset(options: HrtfAssetLoadOptions): Promise<Uint8Array> {
  const key = hrtfAssetCacheKey(options.descriptor);
  return withHrtfAssetCacheLock(key, options.signal, () => fetchHrtfAssetUnlocked(options, key));
}

async function fetchHrtfAssetUnlocked(
  options: HrtfAssetLoadOptions,
  cacheKey: string,
): Promise<Uint8Array> {
  const {descriptor, bundled, wasmUrl, fetcher, cache, signal, onStage} = options;
  if (!bundled) {
    if (cache === null) throw new Error('persistent browser cache is unavailable for this built-in HRTF');
    const cached = await cache.match(cacheKey);
    if (cached !== undefined) {
      onStage?.('cached');
      onStage?.('verifying');
      const cachedBytes = await readAndVerifyHrtfAsset(cached, descriptor, signal);
      if (cachedBytes !== null) {
        onStage?.('preparing');
        return cachedBytes;
      }
      await cache.delete(cacheKey);
    }
    onStage?.('download-required');
    onStage?.('downloading');
  } else {
    onStage?.('available');
  }

  const assetUrl = bundled
    ? new URL(`./hrtf/${descriptor.fileName}`, wasmUrl)
    : new URL(descriptor.url);
  let response: Response;
  try {
    response = await fetcher(assetUrl, {signal});
  } catch (error: unknown) {
    if (signal.aborted) throw error;
    throw new Error(`failed to download built-in HRTF ${descriptor.presetId}; check the network and retry, or use the Full offline package`, {cause: error});
  }
  if (!response.ok) {
    const hint = response.status === 404
      ? 'the versioned HRTF asset release is missing'
      : `HTTP ${response.status}`;
    throw new Error(`failed to load built-in HRTF ${descriptor.presetId}: ${hint}; check the network and retry, or use the Full offline package`);
  }
  onStage?.('verifying');
  const bytes = await readAndVerifyHrtfAsset(response, descriptor, signal);
  if (bytes === null) {
    throw new Error(`built-in HRTF ${descriptor.presetId} failed size or SHA-256 verification`);
  }
  if (!bundled) {
    if (cache === null) throw new Error('persistent browser cache is unavailable for this built-in HRTF');
    if (signal.aborted) throw signal.reason ?? new DOMException('HRTF load canceled', 'AbortError');
    try {
      await cache.put(cacheKey, responseFromVerifiedBytes(bytes));
    } catch (error: unknown) {
      throw new Error('verified HRTF loaded but persistent browser cache write failed; check extension storage space', {cause: error});
    }
  }
  onStage?.('preparing');
  return bytes;
}

async function withHrtfAssetCacheLock<T>(
  key: string,
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = HRTF_ASSET_CACHE_LOCKS.get(key) ?? Promise.resolve();
  let releaseCurrent = (): void => {};
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const queued = previous.then(() => current);
  HRTF_ASSET_CACHE_LOCKS.set(key, queued);
  let acquired = false;
  try {
    await waitForCacheLock(previous, signal);
    acquired = true;
    if (signal.aborted) throw abortReason(signal);
    return await operation();
  } finally {
    if (acquired) {
      releaseCurrent();
      if (HRTF_ASSET_CACHE_LOCKS.get(key) === queued) HRTF_ASSET_CACHE_LOCKS.delete(key);
    } else {
      const releaseAfterPrevious = (): void => {
        releaseCurrent();
        if (HRTF_ASSET_CACHE_LOCKS.get(key) === queued) HRTF_ASSET_CACHE_LOCKS.delete(key);
      };
      void previous.then(releaseAfterPrevious, releaseAfterPrevious);
    }
  }
}

function waitForCacheLock(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, {once: true});
    void previous.then(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, (error: unknown) => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('HRTF load canceled', 'AbortError');
}

/** Removes downloaded HRTF responses from extension-origin Cache Storage. */
export async function clearHrtfAssetCache(cacheStorage: Pick<CacheStorage, 'delete'> = globalThis.caches): Promise<boolean> {
  return cacheStorage.delete(HRTF_ASSET_CACHE_NAME);
}

function parseManifestAsset(
  assets: Record<string, unknown>,
  preset: HrtfPreset,
  baseUrl: URL,
): HrtfManifestAsset {
  if (!Object.hasOwn(assets, preset)) throw new Error(`built-in HRTF manifest is missing ${preset}`);
  const value = assets[preset];
  if (!isRecord(value)) throw new Error(`invalid built-in HRTF manifest entry: ${preset}`);
  const expected = hrtfAssetMetadata(preset);
  const expectedUrl = new URL(expected.fileName, baseUrl).href;
  if (value.presetId !== preset
    || value.assetVersion !== HRTF_ASSET_VERSION
    || value.fileName !== expected.fileName
    || value.byteLength !== expected.byteLength
    || value.sha256 !== expected.sha256
    || value.url !== expectedUrl
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
    url: expectedUrl,
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

function parseHttpsBaseUrl(value: string): URL {
  let baseUrl: URL;
  try {
    baseUrl = new URL(value);
  } catch {
    throw new Error('built-in HRTF asset base URL is invalid');
  }
  const expectedBaseUrl = `https://github.com/chyinan/OpenJOC/releases/download/${HRTF_ASSET_VERSION}/`;
  if (baseUrl.href !== expectedBaseUrl) {
    throw new Error('built-in HRTF asset base URL must match the pinned OpenJOC HTTPS release');
  }
  return baseUrl;
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
  // it directly avoids an additional 200 MB copy for Aachen.
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  if (signal.aborted) throw signal.reason ?? new DOMException('HRTF load canceled', 'AbortError');
  const actualHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  return actualHash === descriptor.sha256 ? bytes : null;
}

function responseFromVerifiedBytes(bytes: Uint8Array): Response {
  const chunkSize = 1024 * 1024;
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller): void {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
  return new Response(body, {
    headers: {'content-type': 'application/octet-stream', 'content-length': String(bytes.byteLength)},
  });
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
