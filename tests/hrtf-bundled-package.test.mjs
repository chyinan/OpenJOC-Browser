// pattern: Imperative Shell

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(browserRoot, 'extension', 'wasm', 'hrtf', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const expectedPresets = ['sadie-ii-d1-ku100', 'sadie-ii-d2-kemar'];

test('standard built-in HRTF manifest contains only packaged profiles', () => {
  assert.equal(manifest.packageKind, 'standard');
  assert.deepEqual(manifest.bundledPresets, expectedPresets);
  assert.deepEqual(Object.keys(manifest.assets).toSorted(), expectedPresets);
  assert.equal(Object.hasOwn(manifest, 'baseUrl'), false);
  for (const asset of Object.values(manifest.assets)) {
    assert.equal(Object.hasOwn(asset, 'url'), false);
  }
});
