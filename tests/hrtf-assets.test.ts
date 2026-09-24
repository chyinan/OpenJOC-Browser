// pattern: Imperative Shell

import {DEFAULT_HRTF_PRESET, HRTF_ASSET_VERSION, HRTF_PRESET_OPTIONS, isHrtfPreset, normalizeHrtfPreset, resolveCustomSofaRevision, type HrtfPreset, hrtfAssetMetadata} from '../src/hrtf-presets.js';
import {DecoderGenerationSlot} from '../src/decoder-generation.js';
import {
  clearRetiredHrtfAssetCache,
  fetchHrtfAsset,
  validateHrtfManifest,
  type HrtfManifestAsset,
  type HrtfAssetLoadOptions,
  type HrtfAssetLoadStage,
  type HrtfManifest,
} from '../src/hrtf-assets.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const stableBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(stableBuffer).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', stableBuffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

class MemoryHrtfCache {
  private readonly entries = new Set<string>();

  public add(key: string): void {
    this.entries.add(key);
  }

  public has(key: string): boolean {
    return this.entries.has(key);
  }

  public get size(): number {
    return this.entries.size;
  }

  public async delete(request: RequestInfo | URL): Promise<boolean> {
    const key = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    return this.entries.delete(key);
  }
}

type PackagedLoadOptions = Readonly<{
  readonly asset: HrtfManifestAsset;
  readonly fetcher: typeof fetch;
  readonly onStage?: (stage: HrtfAssetLoadStage) => void;
  readonly signal?: AbortSignal;
}>;

function packagedLoadOptions(options: PackagedLoadOptions): HrtfAssetLoadOptions {
  return {
    descriptor: options.asset,
    wasmUrl: new URL('chrome-extension://test/wasm/openjoc_wasm.wasm'),
    fetcher: options.fetcher,
    signal: options.signal ?? new AbortController().signal,
    onStage: options.onStage,
  };
}

function descriptor(preset: HrtfPreset, byteLength: number, sha: string): HrtfManifestAsset {
  const metadata = hrtfAssetMetadata(preset);
  return {
    presetId: preset,
    assetVersion: HRTF_ASSET_VERSION,
    fileName: metadata.fileName,
    byteLength,
    sha256: sha,
    dataset: 'test dataset',
    source: 'https://example.org/source',
    authorsInstitution: 'test institution',
    doi: null,
    license: 'test license',
    sampleRateHz: 48_000,
    directionCount: 1,
    tapCount: 1,
    notes: 'test asset',
  };
}

function manifestAsset(preset: HrtfPreset): HrtfManifestAsset {
  const metadata = hrtfAssetMetadata(preset);
  return {
    presetId: preset,
    assetVersion: HRTF_ASSET_VERSION,
    fileName: metadata.fileName,
    byteLength: metadata.byteLength,
    sha256: metadata.sha256,
    dataset: 'official dataset',
    source: 'https://example.org/source',
    authorsInstitution: 'OpenJOC upstream institution',
    doi: null,
    license: 'CC-BY-4.0',
    sampleRateHz: 48_000,
    directionCount: 1,
    tapCount: 384,
    notes: 'validated test metadata',
  };
}

function testManifest(): HrtfManifest {
  return {
    schemaVersion: 1,
    assetVersion: HRTF_ASSET_VERSION,
    packageKind: 'standard',
    bundledPresets: ['sadie-ii-d1-ku100', 'sadie-ii-d2-kemar'],
    assets: {
      'sadie-ii-d1-ku100': manifestAsset('sadie-ii-d1-ku100'),
      'sadie-ii-d2-kemar': manifestAsset('sadie-ii-d2-kemar'),
    },
  };
}

async function run(): Promise<void> {
  const payload = new Uint8Array([0x4f, 0x4a, 0x48, 0x52, 0x54, 0x46, 0x32]);
  const payloadSha = await sha256(payload);
  const stages: Array<HrtfAssetLoadStage> = [];
  const packagedRequests: Array<string> = [];

  assert(DEFAULT_HRTF_PRESET === 'sadie-ii-d1-ku100', 'D1 remains the default offline preset');
  assert(HRTF_PRESET_OPTIONS.map((option) => option.id).join(',') === 'sadie-ii-d1-ku100,sadie-ii-d2-kemar', 'only D1 and D2 remain built-in presets');
  assert(!isHrtfPreset('aachen-high-resolution-kemar'), 'Aachen is no longer a selectable built-in preset');
  assert(normalizeHrtfPreset('aachen-high-resolution-kemar') === DEFAULT_HRTF_PRESET, 'a saved Aachen selection migrates safely to default D1');
  assert(resolveCustomSofaRevision('a'.repeat(64), 'b'.repeat(64)) === 'a'.repeat(64), 'an active Custom SOFA revision takes precedence');
  assert(resolveCustomSofaRevision(null, 'b'.repeat(64)) === 'b'.repeat(64), 'the last cached Custom SOFA remains selectable after switching to a built-in preset');
  assert(resolveCustomSofaRevision('invalid', null) === null, 'invalid or missing Custom SOFA revisions fail closed');

  const packagedFetch: typeof fetch = async (input): Promise<Response> => {
    const url = new URL(String(input));
    assert(url.protocol === 'chrome-extension:', 'built-in HRTF bytes are read only from the extension package');
    packagedRequests.push(url.href);
    return new Response(payload.slice());
  };
  const loadedByPreset = new Map<HrtfPreset, Uint8Array>();
  for (const preset of HRTF_PRESET_OPTIONS.map((option) => option.id)) {
    const asset = descriptor(preset, payload.byteLength, payloadSha);
    const bytes = await fetchHrtfAsset(packagedLoadOptions({asset, fetcher: packagedFetch, onStage: (stage) => stages.push(stage)}));
    loadedByPreset.set(preset, bytes);
    assert(equalBytes(bytes, payload), `${preset} loads its packaged HRIR bytes`);
  }
  assert(packagedRequests.length === 2, 'one extension-local asset request is made for each built-in preset');
  assert(stages.join(',') === 'verifying,preparing,verifying,preparing', 'packaged loads report verification and preparation only');
  assert(stages.includes('verifying') && stages.includes('preparing'), 'packaged assets are verified before renderer preparation');

  const kemar = descriptor('sadie-ii-d2-kemar', payload.byteLength, '0'.repeat(64));
  let badDigestRejected = false;
  try {
    await fetchHrtfAsset(packagedLoadOptions({asset: kemar, fetcher: packagedFetch}));
  } catch {
    badDigestRejected = true;
  }
  assert(badDigestRejected, 'a same-length packaged asset with the wrong SHA-256 is rejected');

  const missingAsset = async (): Promise<Response> => new Response(null, {status: 404});
  let missingAssetRejected = false;
  try {
    await fetchHrtfAsset(packagedLoadOptions({asset: descriptor('sadie-ii-d2-kemar', payload.byteLength, payloadSha), fetcher: missingAsset}));
  } catch {
    missingAssetRejected = true;
  }
  assert(missingAssetRejected, 'missing local D2 data fails without falling back to a remote download');

  const d1Asset = descriptor('sadie-ii-d1-ku100', payload.byteLength, payloadSha);
  const activeSlot = new DecoderGenerationSlot(
    async (_signal: AbortSignal, generation: number): Promise<Readonly<{id: string}>> => {
      if (generation === 1) return {id: 'active-d1'};
      await fetchHrtfAsset(packagedLoadOptions({asset: descriptor('sadie-ii-d2-kemar', payload.byteLength, payloadSha), fetcher: missingAsset}));
      return {id: 'unreachable'};
    },
    (): void => {},
  );
  const activeD1 = await activeSlot.start(1);
  activeSlot.finish(1);
  await activeSlot.start(2).catch((): void => {});
  assert(activeSlot.current() === activeD1, 'failed packaged D2 loading leaves the active D1 decoder in place');
  assert(loadedByPreset.has(d1Asset.presetId), 'D1 remains one of the directly packaged profiles');

  const retiredProfileCache = new MemoryHrtfCache();
  const retiredAachenKey = 'https://openjoc-cache.invalid/openjoc-hrtf-v2.0.0/aachen-high-resolution-kemar/2cc2f2d93194be681d4e446d66b4007060bc6c768cf7026c92e5efb87cf06dc3';
  const oldDownloadedD2Key = 'https://openjoc-cache.invalid/openjoc-hrtf-v2.0.0/sadie-ii-d2-kemar/b2f42ca2ce9ef2dfa7e3eff263543c4f306d0ac95bd684cf5ca344c88d6bd461';
  const unrelatedCacheKey = 'https://openjoc-cache.invalid/openjoc-hrtf-v2.1.0/sadie-ii-d2-kemar/other';
  retiredProfileCache.add(retiredAachenKey);
  retiredProfileCache.add(oldDownloadedD2Key);
  retiredProfileCache.add(unrelatedCacheKey);
  assert(await clearRetiredHrtfAssetCache(retiredProfileCache) === 2, 'upgrade migration removes old Aachen and D2 downloads');
  assert(!retiredProfileCache.has(retiredAachenKey), 'retired Aachen bytes are reclaimed from extension cache');
  assert(!retiredProfileCache.has(oldDownloadedD2Key), 'bundled D2 no longer remains duplicated in extension cache');
  assert(retiredProfileCache.has(unrelatedCacheKey), 'cache migration preserves unrelated asset versions');

  const manifest = testManifest();
  assert(validateHrtfManifest(manifest).packageKind === 'standard', 'standard manifest validates with both built-in profiles bundled');
  for (const bundledPresets of [['sadie-ii-d1-ku100'], ['sadie-ii-d2-kemar']]) {
    let rejected = false;
    try {
      validateHrtfManifest({...manifest, bundledPresets});
    } catch {
      rejected = true;
    }
    assert(rejected, 'manifest cannot make a selectable built-in profile download-only');
  }
  const manifestWithExtraAsset = {
    ...manifest,
    assets: {...manifest.assets, 'unexpected-preset': manifest.assets['sadie-ii-d1-ku100']},
  };
  let extraAssetRejected = false;
  try {
    validateHrtfManifest(manifestWithExtraAsset);
  } catch {
    extraAssetRejected = true;
  }
  assert(extraAssetRejected, 'manifest rejects asset keys that are absent from the preset registry');
  assert(!Object.hasOwn(manifest, 'baseUrl'), 'built-in asset manifest has no remote distribution base URL');
  for (const asset of Object.values(manifest.assets)) {
    assert(!Object.hasOwn(asset, 'url'), 'built-in asset manifest contains no remote download URL');
  }
}

await run();
