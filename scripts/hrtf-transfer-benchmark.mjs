// pattern: Imperative Shell

import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream, statSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rename, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {fetchHrtfAsset, validateHrtfManifest} from '../extension/hrtf-assets.js';

class DiskBackedCache {
  constructor(root) {
    this.root = root;
  }

  async match(request) {
    const path = this.filePath(request);
    try {
      const fileStats = await stat(path);
      return new Response(Readable.toWeb(createReadStream(path)), {
        headers: {'content-length': String(fileStats.size)},
      });
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async put(request, response) {
    if (response.body === null) throw new Error('benchmark response has no body');
    const path = this.filePath(request);
    const pendingPath = `${path}.pending`;
    await pipeline(Readable.fromWeb(response.body), createWriteStream(pendingPath));
    await rename(pendingPath, path);
  }

  async delete(request) {
    const path = this.filePath(request);
    try {
      await rm(path);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  filePath(request) {
    const key = typeof request === 'string' ? request : String(request);
    return join(this.root, `${createHash('sha256').update(key).digest('hex')}.ojhrtf`);
  }
}

const browserRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const assetsRoot = join(browserRoot, 'extension', 'wasm', 'hrtf');
const manifest = validateHrtfManifest(JSON.parse(await readFile(join(assetsRoot, 'manifest.json'), 'utf8')));
const temporaryRoot = await mkdtemp(join(tmpdir(), 'openjoc-hrtf-transfer-'));
const cacheRoot = join(temporaryRoot, 'cache');
await mkdir(cacheRoot);
const server = createServer((request, response) => {
  const fileName = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname.slice(1));
  const asset = Object.values(manifest.assets).find((entry) => entry.fileName === fileName);
  if (asset === undefined) {
    response.writeHead(404).end();
    return;
  }
  const filePath = join(assetsRoot, asset.fileName);
  const fileBytes = statSync(filePath).size;
  response.writeHead(200, {
    'content-length': String(fileBytes),
    'content-type': 'application/octet-stream',
    'cache-control': 'no-store',
    'accept-ranges': 'bytes',
  });
  createReadStream(filePath).pipe(response);
});
await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(0, '127.0.0.1', resolveListen);
});
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('loopback HRTF benchmark server failed to bind');
const loopbackBaseUrl = `http://127.0.0.1:${address.port}/`;

try {
  for (const presetId of ['sadie-ii-d2-kemar', 'aachen-high-resolution-kemar']) {
    const descriptor = manifest.assets[presetId];
    const cache = new DiskBackedCache(cacheRoot);
    const stages = [];
    let networkRequests = 0;
    const loopbackFetch = async (input, init) => {
      const requestedUrl = new URL(String(input));
      if (requestedUrl.href !== descriptor.url) throw new Error(`unexpected benchmark origin URL: ${requestedUrl.href}`);
      networkRequests += 1;
      return fetch(new URL(encodeURIComponent(descriptor.fileName), loopbackBaseUrl), init);
    };
    const controller = new AbortController();
    const downloadStarted = performance.now();
    let downloaded = await fetchHrtfAsset({
      descriptor,
      bundled: false,
      wasmUrl: new URL('chrome-extension://benchmark/wasm/openjoc_wasm.wasm'),
      fetcher: loopbackFetch,
      cache,
      signal: controller.signal,
      onStage: (stage) => stages.push(stage),
    });
    const firstDownloadMs = performance.now() - downloadStarted;
    downloaded = null;
    await releaseGarbage();

    const offlineFetch = async () => {
      throw new Error('offline cache-hit probe must not request the network');
    };
    const cachedStarted = performance.now();
    let cached = await fetchHrtfAsset({
      descriptor,
      bundled: false,
      wasmUrl: new URL('chrome-extension://benchmark/wasm/openjoc_wasm.wasm'),
      fetcher: offlineFetch,
      cache,
      signal: controller.signal,
      onStage: (stage) => stages.push(stage),
    });
    const cachedLoadMs = performance.now() - cachedStarted;
    const checksum = createHash('sha256').update(cached).digest('hex');
    cached = null;
    await releaseGarbage();
    console.log(JSON.stringify({
      preset: presetId,
      environment: 'loopback HTTP serving the verified release asset bytes',
      cacheBackend: 'disk-backed CacheStorage-compatible test double',
      assetBytes: descriptor.byteLength,
      firstDownloadAndVerifyAndPersistMs: Number(firstDownloadMs.toFixed(2)),
      cachedReadAndVerifyMs: Number(cachedLoadMs.toFixed(2)),
      networkRequests,
      verifiedSha256: checksum,
      expectedSha256: descriptor.sha256,
      stages,
      persistentCacheHitWorksOffline: checksum === descriptor.sha256 && networkRequests === 1,
    }));
  }
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temporaryRoot, {recursive: true, force: true});
}

async function releaseGarbage() {
  await new Promise((resolveTurn) => setImmediate(resolveTurn));
  if (typeof global.gc === 'function') global.gc();
}
