// pattern: Imperative Shell

import {DEFAULT_HRTF_PRESET, HRTF_ASSET_VERSION, type HrtfPreset, hrtfAssetMetadata} from '../src/hrtf-presets.js';
import {DecoderGenerationSlot} from '../src/decoder-generation.js';
import {
  fetchHrtfAsset,
  hrtfAssetCacheKey,
  validateHrtfManifest,
  type HrtfManifestAsset,
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
  private readonly entries = new Map<string, Uint8Array>();
  public putCount = 0;

  public async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const bytes = this.entries.get(requestUrl(request));
    return bytes === undefined ? undefined : new Response(bytes.slice());
  }

  public async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.putCount += 1;
    this.entries.set(requestUrl(request), new Uint8Array(await response.arrayBuffer()));
  }

  public async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(requestUrl(request));
  }
}

function requestUrl(request: RequestInfo | URL): string {
  if (typeof request === 'string') return request;
  return request instanceof URL ? request.href : request.url;
}

function descriptor(preset: HrtfPreset, bytes: Uint8Array, assetVersion = HRTF_ASSET_VERSION): HrtfManifestAsset {
  const metadata = hrtfAssetMetadata(preset);
  return {
    presetId: preset,
    assetVersion,
    fileName: metadata.fileName,
    byteLength: bytes.byteLength,
    sha256: '',
    url: `https://assets.example.test/hrtf/${assetVersion}/${metadata.fileName}`,
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

async function withDigest(asset: HrtfManifestAsset, bytes: Uint8Array): Promise<HrtfManifestAsset> {
  return {...asset, sha256: await sha256(bytes)};
}

function dependencies(
  asset: HrtfManifestAsset,
  cache: Pick<Cache, 'match' | 'put' | 'delete'>,
  bundled: boolean,
  fetcher: typeof fetch,
  onStage: (stage: HrtfAssetLoadStage) => void = (): void => {},
  signal: AbortSignal = new AbortController().signal,
) {
  return {
    descriptor: asset,
    bundled,
    wasmUrl: new URL('chrome-extension://test/wasm/openjoc_wasm.wasm'),
    fetcher,
    cache: cache as unknown as Pick<Cache, 'match' | 'put' | 'delete'>,
    signal,
    onStage,
  };
}

async function run(): Promise<void> {
  const payload = new Uint8Array([0x4f, 0x4a, 0x48, 0x52, 0x54, 0x46, 0x32]);
  const cache = new MemoryHrtfCache();
  const stages: Array<HrtfAssetLoadStage> = [];

  assert(DEFAULT_HRTF_PRESET === 'sadie-ii-d1-ku100', 'D1 remains the default offline preset');

  const included = await withDigest(descriptor(DEFAULT_HRTF_PRESET, payload), payload);
  let networkRequests = 0;
  const packagedFetch: typeof fetch = async (input): Promise<Response> => {
    networkRequests += 1;
    assert(String(input).includes('/hrtf/'), 'bundled D1 is loaded from the extension package');
    return new Response(payload.slice());
  };
  const includedBytes = await fetchHrtfAsset(dependencies(included, cache, true, packagedFetch, (stage) => stages.push(stage)));
  assert(equalBytes(includedBytes, payload), 'fresh offline installation can load the packaged D1 asset');
  assert(networkRequests === 1, 'packaged D1 does not use a remote download');
  assert(stages.includes('available'), 'packaged D1 reports available state');

  const kemar = await withDigest(descriptor('sadie-ii-d2-kemar', payload), payload);
  const offlineFetch: typeof fetch = async (): Promise<Response> => {
    throw new Error('offline');
  };
  let offlineFailed = false;
  try {
    await fetchHrtfAsset(dependencies(kemar, cache, false, offlineFetch, (stage) => stages.push(stage)));
  } catch {
    offlineFailed = true;
  }
  assert(offlineFailed, 'uncached D2 is unavailable offline');
  assert(stages.includes('download-required'), 'uncached D2 reports download required');

  const retainedSlot = new DecoderGenerationSlot<Readonly<{id: string}>>(
    async (_signal: AbortSignal, generation: number): Promise<Readonly<{id: string}>> => {
      if (generation === 1) return {id: 'active-d1'};
      await fetchHrtfAsset(dependencies(kemar, cache, false, offlineFetch));
      return {id: 'unreachable'};
    },
    (): void => {},
  );
  const activeDecoder = await retainedSlot.start(1);
  retainedSlot.finish(1);
  try {
    await retainedSlot.start(2);
  } catch {
    // The failed network replacement must leave D1 as the active decoder.
  }
  assert(retainedSlot.current() === activeDecoder, 'failed offline D2 fetch keeps the active D1 decoder instance');

  const oversizedCache = new MemoryHrtfCache();
  const oversizedBytes = new Uint8Array([...payload, 0xff]);
  const oversizedResponse = new Response(new ReadableStream<Uint8Array>({
    start(controller): void {
      controller.enqueue(oversizedBytes);
      controller.close();
    },
  }));
  let oversizedRejected = false;
  try {
    await fetchHrtfAsset(dependencies(kemar, oversizedCache, false, async (): Promise<Response> => oversizedResponse.clone()));
  } catch {
    oversizedRejected = true;
  }
  assert(oversizedRejected, 'an oversized chunked download is rejected before it can be persisted');
  assert(oversizedCache.putCount === 0, 'unverified network bytes never enter the persistent cache');

  const badDigestCache = new MemoryHrtfCache();
  const badDigest = {...kemar, sha256: '0'.repeat(64)};
  let badDigestRejected = false;
  try {
    await fetchHrtfAsset(dependencies(badDigest, badDigestCache, false, async (): Promise<Response> => new Response(payload.slice())));
  } catch {
    badDigestRejected = true;
  }
  assert(badDigestRejected, 'a same-length body with the wrong SHA-256 is rejected');
  assert(badDigestCache.putCount === 0, 'SHA-mismatched data is not persisted');

  await cache.put(hrtfAssetCacheKey(kemar), new Response(payload.slice()));
  networkRequests = 0;
  const cachedKemar = await fetchHrtfAsset(dependencies(kemar, cache, false, offlineFetch, (stage) => stages.push(stage)));
  assert(equalBytes(cachedKemar, payload), 'a previously downloaded D2 works offline from persistent cache');
  assert(networkRequests === 0, 'cached D2 does not refetch');
  assert(stages.includes('cached'), 'cached D2 reports cached state');

  const aachen = await withDigest(descriptor('aachen-high-resolution-kemar', payload), payload);
  await cache.put(hrtfAssetCacheKey(aachen), new Response(payload.slice()));
  const cachedAachen = await fetchHrtfAsset(dependencies(aachen, cache, false, offlineFetch));
  assert(equalBytes(cachedAachen, payload), 'a previously downloaded Aachen asset works offline');

  const corruptCache = new MemoryHrtfCache();
  await corruptCache.put(hrtfAssetCacheKey(kemar), new Response(new Uint8Array([1, 2])));
  const refreshed = await fetchHrtfAsset(dependencies(kemar, corruptCache, false, async (): Promise<Response> => new Response(payload.slice())));
  assert(equalBytes(refreshed, payload), 'corrupt cache entry is discarded and refetched');

  const delayedCache = new MemoryHrtfCache();
  let unblockFirstMatch = (): void => {};
  let announceFirstMatch = (): void => {};
  const firstMatchStarted = new Promise<void>((resolveStarted) => {
    announceFirstMatch = resolveStarted;
  });
  const firstMatchBarrier = new Promise<void>((resolveBarrier) => {
    unblockFirstMatch = resolveBarrier;
  });
  let matchCallCount = 0;
  let activeMatches = 0;
  let peakActiveMatches = 0;
  const serializedCache: Pick<Cache, 'match' | 'put' | 'delete'> = {
    match: async (request): Promise<Response | undefined> => {
      matchCallCount += 1;
      activeMatches += 1;
      peakActiveMatches = Math.max(peakActiveMatches, activeMatches);
      try {
        if (matchCallCount === 1) {
          announceFirstMatch();
          await firstMatchBarrier;
        }
        return await delayedCache.match(request);
      } finally {
        activeMatches -= 1;
      }
    },
    put: async (request, response): Promise<void> => delayedCache.put(request, response),
    delete: async (request): Promise<boolean> => delayedCache.delete(request),
  };
  let serializedNetworkRequests = 0;
  const serializedFetcher: typeof fetch = async (): Promise<Response> => {
    serializedNetworkRequests += 1;
    return new Response(payload.slice());
  };
  const firstLockFetch = fetchHrtfAsset(dependencies(kemar, serializedCache, false, serializedFetcher));
  await firstMatchStarted;
  const abandonedController = new AbortController();
  const abandonedFetch = fetchHrtfAsset(dependencies(
    kemar,
    serializedCache,
    false,
    serializedFetcher,
    (): void => {},
    abandonedController.signal,
  ));
  abandonedController.abort();
  let abandoned = false;
  await abandonedFetch.catch((): void => {
    abandoned = true;
  });
  assert(abandoned, 'an aborted cache-lock waiter returns without entering the cache');
  const newestLockFetch = fetchHrtfAsset(dependencies(kemar, serializedCache, false, serializedFetcher));
  for (let turn = 0; turn < 8 && matchCallCount === 1; turn += 1) await Promise.resolve();
  const overlappingMatches = peakActiveMatches;
  unblockFirstMatch();
  const serializedBytes = await Promise.all([firstLockFetch, newestLockFetch]);
  assert(overlappingMatches === 1, 'an aborted waiter cannot remove the lock held by an earlier cache operation');
  assert(serializedNetworkRequests === 1, 'the latest waiter reads the asset cached by the original operation');
  assert(serializedBytes.every((bytes) => equalBytes(bytes, payload)), 'both ordered requests receive verified bytes');

  const stale = await withDigest(descriptor('sadie-ii-d2-kemar', payload, 'older-asset'), payload);
  assert(hrtfAssetCacheKey(stale) !== hrtfAssetCacheKey(kemar), 'cache identity includes asset version and checksum');

  const manifest = testManifest();
  assert(validateHrtfManifest(manifest).packageKind === 'standard', 'standard manifest validates with D1 bundled');
  const badManifest = {...manifest, bundledPresets: ['sadie-ii-d2-kemar']};
  let rejected = false;
  try {
    validateHrtfManifest(badManifest);
  } catch {
    rejected = true;
  }
  assert(rejected, 'manifest cannot remove the offline D1 default or bundle an invalid preset set');

  const redirectedBaseUrl = 'https://github.com/untrusted-owner/OpenJOC/releases/download/openjoc-hrtf-v2.0.0/';
  const redirectedAssets = {
    'sadie-ii-d1-ku100': {...manifest.assets['sadie-ii-d1-ku100'], url: new URL(manifest.assets['sadie-ii-d1-ku100'].fileName, redirectedBaseUrl).href},
    'sadie-ii-d2-kemar': {...manifest.assets['sadie-ii-d2-kemar'], url: new URL(manifest.assets['sadie-ii-d2-kemar'].fileName, redirectedBaseUrl).href},
    'aachen-high-resolution-kemar': {...manifest.assets['aachen-high-resolution-kemar'], url: new URL(manifest.assets['aachen-high-resolution-kemar'].fileName, redirectedBaseUrl).href},
  };
  let redirectedRepositoryRejected = false;
  try {
    validateHrtfManifest({...manifest, baseUrl: redirectedBaseUrl, assets: redirectedAssets});
  } catch {
    redirectedRepositoryRejected = true;
  }
  assert(redirectedRepositoryRejected, 'the local asset manifest cannot redirect downloads to another GitHub repository');
}

function testManifest(): HrtfManifest {
  const createAsset = (preset: HrtfPreset): HrtfManifestAsset => {
    const metadata = hrtfAssetMetadata(preset);
    return {
      presetId: preset,
      assetVersion: HRTF_ASSET_VERSION,
      fileName: metadata.fileName,
      byteLength: metadata.byteLength,
      sha256: metadata.sha256,
      url: `https://github.com/chyinan/OpenJOC/releases/download/openjoc-hrtf-v2.0.0/${metadata.fileName}`,
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
  };
  return {
    schemaVersion: 1,
    assetVersion: HRTF_ASSET_VERSION,
    packageKind: 'standard',
    baseUrl: 'https://github.com/chyinan/OpenJOC/releases/download/openjoc-hrtf-v2.0.0/',
    bundledPresets: ['sadie-ii-d1-ku100'],
    assets: {
      'sadie-ii-d1-ku100': createAsset('sadie-ii-d1-ku100'),
      'sadie-ii-d2-kemar': createAsset('sadie-ii-d2-kemar'),
      'aachen-high-resolution-kemar': createAsset('aachen-high-resolution-kemar'),
    },
  };
}

await run();
