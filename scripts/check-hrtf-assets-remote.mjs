// pattern: Imperative Shell

import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateHrtfManifest} from '../extension/hrtf-assets.js';
import {verifyHrtfAssetResponse} from './hrtf-release-gate.mjs';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(browserRoot, 'extension', 'wasm', 'hrtf', 'manifest.json');
const manifest = validateHrtfManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
if (manifest.packageKind !== 'standard'
  || manifest.bundledPresets.length !== 1
  || manifest.bundledPresets[0] !== 'sadie-ii-d1-ku100') {
  throw new Error('remote HRTF release gate requires the Standard manifest with only D1 bundled');
}

const externalPresets = ['sadie-ii-d2-kemar', 'aachen-high-resolution-kemar'];
const allowedFinalOrigins = new Set([
  'https://github.com',
  'https://release-assets.githubusercontent.com',
]);
let failures = 0;
for (const presetId of externalPresets) {
  const descriptor = manifest.assets[presetId];
  try {
    const response = await fetch(descriptor.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10 * 60_000),
    });
    const finalUrl = new URL(response.url || descriptor.url);
    if (!allowedFinalOrigins.has(finalUrl.origin)
      || (finalUrl.origin === 'https://github.com' && finalUrl.href !== descriptor.url)) {
      await response.body?.cancel();
      throw new Error(`unexpected asset response host: ${finalUrl.origin}`);
    }
    const verified = await verifyHrtfAssetResponse(response, descriptor);
    console.log(`REMOTE_HRTF_ASSET=PASS preset=${presetId} bytes=${verified.byteLength} sha256=${verified.sha256}`);
  } catch (error) {
    failures += 1;
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`REMOTE_HRTF_ASSET=FAIL preset=${presetId} detail=${detail}`);
  }
}
if (failures > 0) {
  throw new Error(`${failures} remote HRTF release asset(s) are unavailable or failed integrity verification; block Browser release`);
}
