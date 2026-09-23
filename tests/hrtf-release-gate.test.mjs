// pattern: Imperative Shell

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';

import {
  validatePinnedHrtfAssetBaseUrl,
  verifyHrtfAssetResponse,
} from '../scripts/hrtf-release-gate.mjs';

const bytes = new Uint8Array([0x4f, 0x4a, 0x48, 0x52, 0x54, 0x46, 0x32]);
const descriptor = {
  presetId: 'aachen-high-resolution-kemar',
  byteLength: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};

test('release asset base URL is pinned to the authoritative OpenJOC repository', () => {
  const officialUrl = 'https://github.com/chyinan/OpenJOC/releases/download/openjoc-hrtf-v2.0.0/';
  assert.equal(validatePinnedHrtfAssetBaseUrl(officialUrl, 'openjoc-hrtf-v2.0.0').href, officialUrl);
  assert.throws(
    () => validatePinnedHrtfAssetBaseUrl('https://github.com/untrusted/OpenJOC/releases/download/openjoc-hrtf-v2.0.0/', 'openjoc-hrtf-v2.0.0'),
    /pinned OpenJOC release/u,
  );
});

test('release gate accepts a streamed asset only when its exact size and SHA-256 match', async () => {
  const result = await verifyHrtfAssetResponse(new Response(bytes.slice()), descriptor);
  assert.deepEqual(result, {byteLength: bytes.byteLength, sha256: descriptor.sha256});
});

test('release gate rejects an unavailable remote asset', async () => {
  await assert.rejects(verifyHrtfAssetResponse(new Response(null, {status: 404}), descriptor), /HTTP 404/u);
});

test('release gate rejects wrong-size and wrong-digest bodies', async () => {
  await assert.rejects(verifyHrtfAssetResponse(new Response(bytes.slice(1)), descriptor), /byte length/u);
  await assert.rejects(verifyHrtfAssetResponse(new Response(bytes.slice(), {headers: {'content-length': '8'}}), descriptor), /content-length/u);
  await assert.rejects(verifyHrtfAssetResponse(new Response(bytes.slice()), {...descriptor, sha256: '0'.repeat(64)}), /SHA-256/u);
});
