// pattern: Imperative Shell

import {existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const OPENJOC_REPOSITORY = 'https://github.com/chyinan/OpenJOC.git';
export const OPENJOC_SOURCE_REF = 'codex/openjoc-wasm-bridge';
export const OPENJOC_SOURCE_PIN = 'e123aa3a0e2878587c73130585a5606db4ff233f';
export const OPENJOC_ARCHIVE_URL = `https://codeload.github.com/chyinan/OpenJOC/tar.gz/${OPENJOC_SOURCE_PIN}`;
const SOURCE_FETCH_TIMEOUT_MS = 30_000;

/** Resolves a checked-out OpenJOC source tree at the exact public release pin. */
export async function resolveOpenjocRoot() {
  const configuredRoot = process.env.OPENJOC_ROOT?.trim();
  const root = configuredRoot === undefined || configuredRoot.length === 0
    ? await ensureCachedOpenjoc()
    : resolve(configuredRoot);
  assertPinnedCheckout(root);
  return root;
}

async function ensureCachedOpenjoc() {
  const root = join(browserRoot, '.cache', 'openjoc', OPENJOC_SOURCE_PIN);
  if (!existsSync(join(root, '.git'))) {
    if (existsSync(root)) rmSync(root, {recursive: true, force: true});
    mkdirSync(dirname(root), {recursive: true});
    try {
      run('git', ['clone', '--no-tags', '--depth', '1', '--single-branch', '--branch', OPENJOC_SOURCE_REF, OPENJOC_REPOSITORY, root], browserRoot);
    } catch {
      if (existsSync(root)) rmSync(root, {recursive: true, force: true});
      console.warn('Git clone failed; fetching the same OpenJOC commit from its pinned GitHub archive');
      await downloadPinnedArchive(root);
    }
  }
  if (readGitHead(root) === OPENJOC_SOURCE_PIN || readArchivePin(root) === OPENJOC_SOURCE_PIN) return root;
  try {
    run('git', ['-C', root, 'fetch', '--no-tags', 'origin', OPENJOC_SOURCE_REF], browserRoot);
    run('git', ['-C', root, 'checkout', '--detach', OPENJOC_SOURCE_PIN], browserRoot);
  } catch {
    rmSync(root, {recursive: true, force: true});
    await downloadPinnedArchive(root);
  }
  return root;
}

async function downloadPinnedArchive(root) {
  const cacheParent = dirname(root);
  const extractionRoot = join(cacheParent, `.extract-${process.pid}`);
  const archivePath = join(cacheParent, `${OPENJOC_SOURCE_PIN}.tar.gz`);
  mkdirSync(extractionRoot, {recursive: true});
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(OPENJOC_ARCHIVE_URL, {signal: controller.signal});
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) throw new Error(`OpenJOC archive request returned status ${response.status}`);
    writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));
    run('tar', ['-xzf', archivePath, '-C', extractionRoot], browserRoot);
    const extracted = readdirSync(extractionRoot, {withFileTypes: true}).find((entry) => entry.isDirectory());
    if (extracted === undefined) throw new Error('OpenJOC archive did not contain a source directory');
    renameSync(join(extractionRoot, extracted.name), root);
    writeFileSync(join(root, '.openjoc-source-pin'), `${OPENJOC_SOURCE_PIN}\n`);
  } finally {
    if (existsSync(archivePath)) rmSync(archivePath, {force: true});
    if (existsSync(extractionRoot)) rmSync(extractionRoot, {recursive: true, force: true});
  }
}

function readGitHead(root) {
  const result = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding: 'utf8'});
  return result.status === 0 ? result.stdout.trim() : null;
}

function assertPinnedCheckout(root) {
  if (!existsSync(join(root, 'Cargo.toml'))) {
    throw new Error(`OpenJOC source is missing Cargo.toml: ${root}`);
  }
  const result = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding: 'utf8'});
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    if (readArchivePin(root) === OPENJOC_SOURCE_PIN) return;
    throw new Error(`OpenJOC source is not a pinned checkout or archive: ${root}`);
  }
  const actual = result.stdout.trim();
  if (actual !== OPENJOC_SOURCE_PIN) {
    throw new Error(`OpenJOC source pin mismatch: expected ${OPENJOC_SOURCE_PIN}, found ${actual}`);
  }
}

function readArchivePin(root) {
  try {
    return readFileSync(join(root, '.openjoc-source-pin'), 'utf8').trim();
  } catch {
    return null;
  }
}

function run(command, arguments_, cwd) {
  const result = spawnSync(command, arguments_, {cwd, stdio: 'inherit'});
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`OpenJOC source command failed (${command} ${arguments_.join(' ')})`);
  }
}
