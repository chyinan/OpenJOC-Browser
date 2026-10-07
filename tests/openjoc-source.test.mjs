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

// Exercise the real resolver without network access or the developer's sibling checkout.
import {cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {OPENJOC_RELEASE} from '../scripts/openjoc-source.mjs';

function withSourceWorkspace(run) {
  const root = mkdtempSync(join(tmpdir(), 'openjoc-source-test-'));
  const browser = join(root, 'Browser');
  const sibling = join(root, 'OpenJOC');
  mkdirSync(join(browser, 'scripts'), {recursive: true});
  mkdirSync(join(sibling, '.git'), {recursive: true});
  writeFileSync(join(sibling, 'Cargo.toml'), '[workspace]\n');
  for (const file of ['openjoc-source.mjs', 'openjoc-source.json']) {
    cpSync(new URL(`../scripts/${file}`, import.meta.url), join(browser, 'scripts', file));
  }
  const invoke = (overrides = {}, resolveRoot = true) => {
    const env = {...process.env};
    for (const key of ['OPENJOC_ROOT', 'OPENJOC_SOURCE_PIN', 'OPENJOC_SOURCE_REF']) delete env[key];
    return spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {resolveOpenjocRoot, OPENJOC_SOURCE_PIN, OPENJOC_SOURCE_REF} from './scripts/openjoc-source.mjs';\nconsole.log(JSON.stringify(${resolveRoot ? 'await resolveOpenjocRoot()' : '{pin: OPENJOC_SOURCE_PIN, ref: OPENJOC_SOURCE_REF}'}));`,
    ], {cwd: browser, env: {...env, ...overrides}, encoding: 'utf8'});
  };
  try { run({browser, sibling, invoke}); } finally { rmSync(root, {recursive: true, force: true}); }
}

test('standalone defaults and both workflows share the reviewed release manifest', () => {
  assert.equal(OPENJOC_RELEASE.version, '0.19.0');
  assert.equal(OPENJOC_RELEASE.commit, '291900ce33ea349c4b855655cdb282819e94eabc');
  withSourceWorkspace(({invoke}) => {
    const result = invoke({}, false);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {pin: OPENJOC_RELEASE.commit, ref: 'v0.19.0'});
    const development = invoke({OPENJOC_SOURCE_REF: 'master'}, false);
    assert.deepEqual(JSON.parse(development.stdout), {pin: null, ref: 'master'});
  });
  for (const name of ['ci.yml', 'release.yml']) {
    const workflow = readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
    assert.match(workflow, /Get-Content scripts\/openjoc-source\.json/u);
    assert.match(workflow, /OPENJOC_SOURCE_PIN=\$\(\$source\.commit\)/u);
    assert.doesNotMatch(workflow, /vars\.OPENJOC_SOURCE_PIN/u);
  }
});

test('local development keeps the neighboring checkout unless an explicit pin is supplied', () => {
  withSourceWorkspace(({browser, sibling, invoke}) => {
    const development = invoke();
    assert.equal(development.status, 0, development.stderr);
    assert.equal(JSON.parse(development.stdout), sibling);
    const cached = join(browser, '.cache', 'openjoc', OPENJOC_RELEASE.commit);
    mkdirSync(cached, {recursive: true});
    writeFileSync(join(cached, 'Cargo.toml'), '[workspace]\n');
    writeFileSync(join(cached, '.openjoc-source-pin'), `${OPENJOC_RELEASE.commit}\n`);
    const pinned = invoke({OPENJOC_SOURCE_PIN: OPENJOC_RELEASE.commit});
    assert.equal(pinned.status, 0, pinned.stderr);
    assert.equal(JSON.parse(pinned.stdout), cached);
    const mismatch = invoke({OPENJOC_ROOT: sibling, OPENJOC_SOURCE_PIN: OPENJOC_RELEASE.commit});
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /not a pinned checkout or archive/u);
  });
});
