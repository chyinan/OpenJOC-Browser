// pattern: Functional Core

import assert from 'node:assert/strict';
import {join, resolve} from 'node:path';
import {test} from 'node:test';

import {assertOpenjocCacheChildPath, normalizeOpenjocSourcePin} from '../scripts/openjoc-source.mjs';

test('OpenJOC source pins are exact commit identifiers, never path fragments', () => {
  assert.equal(normalizeOpenjocSourcePin('a'.repeat(40)), 'a'.repeat(40));
  assert.equal(normalizeOpenjocSourcePin(`  ${'B'.repeat(40)}  `), 'b'.repeat(40));
  assert.equal(normalizeOpenjocSourcePin('   '), null);
  assert.throws(() => normalizeOpenjocSourcePin('../../outside'), /40-character hexadecimal commit SHA/u);
});

test('OpenJOC source cache paths must remain strict descendants of the cache root', () => {
  const cacheRoot = resolve('C:/openjoc-tests/.cache/openjoc');
  const child = join(cacheRoot, 'a'.repeat(40));
  assert.equal(assertOpenjocCacheChildPath(cacheRoot, child), child);
  assert.throws(() => assertOpenjocCacheChildPath(cacheRoot, cacheRoot), /strict descendant/u);
  assert.throws(() => assertOpenjocCacheChildPath(cacheRoot, resolve(cacheRoot, '..', 'outside')), /escapes the source cache/u);
});
