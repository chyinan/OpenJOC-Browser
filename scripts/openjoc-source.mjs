// pattern: Imperative Shell

import {existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const OPENJOC_REPOSITORY = 'https://github.com/chyinan/OpenJOC.git';
export const OPENJOC_SOURCE_REF = process.env.OPENJOC_SOURCE_REF?.trim() || 'master';
export const OPENJOC_SOURCE_PIN = normalizeOpenjocSourcePin(process.env.OPENJOC_SOURCE_PIN);
export const OPENJOC_ARCHIVE_URL = OPENJOC_SOURCE_PIN === null
  ? null
  : `https://codeload.github.com/chyinan/OpenJOC/tar.gz/${OPENJOC_SOURCE_PIN}`;
const SOURCE_FETCH_TIMEOUT_MS = 30_000;

export function normalizeOpenjocSourcePin(value) {
  const pin = value?.trim() ?? '';
  if (pin.length === 0) return null;
  if (!/^[0-9a-f]{40}$/i.test(pin)) {
    throw new Error('OPENJOC_SOURCE_PIN must be a 40-character hexadecimal commit SHA');
  }
  return pin.toLowerCase();
}

export function assertOpenjocCacheChildPath(cacheRoot, targetPath) {
  const normalizedRoot = resolve(cacheRoot);
  const normalizedTarget = resolve(targetPath);
  const relativeTarget = relative(normalizedRoot, normalizedTarget);
  if (relativeTarget.length === 0) {
    throw new Error(`OpenJOC cache target must be a strict descendant of the source cache: ${targetPath}`);
  }
  if (relativeTarget === '..'
    || relativeTarget.startsWith(`..${sep}`)
    || isAbsolute(relativeTarget)) {
    throw new Error(`OpenJOC cache target escapes the source cache: ${targetPath}`);
  }
  return normalizedTarget;
}

/** Uses a sibling OpenJOC checkout for workspace builds; otherwise resolves the public pin. */
export async function resolveOpenjocRoot() {
  const configuredRoot = process.env.OPENJOC_ROOT?.trim();
  if (configuredRoot !== undefined && configuredRoot.length > 0) {
    const root = resolve(configuredRoot);
    if (!existsSync(join(root, 'Cargo.toml'))) throw new Error(`OpenJOC local source is missing Cargo.toml: ${root}`);
    return root;
  }

  const siblingRoot = resolve(browserRoot, '..', 'OpenJOC');
  if (existsSync(join(siblingRoot, 'Cargo.toml')) && existsSync(join(siblingRoot, '.git'))) {
    return siblingRoot;
  }
  const root = await ensureCachedOpenjoc();
  if (OPENJOC_SOURCE_PIN !== null) assertPinnedCheckout(root);
  else assertGitCheckout(root);
  return root;
}

async function ensureCachedOpenjoc() {
  const cacheRoot = resolve(browserRoot, '.cache', 'openjoc');
  const cacheKey = OPENJOC_SOURCE_PIN ?? `ref-${OPENJOC_SOURCE_REF.replaceAll(/[^A-Za-z0-9._-]/g, '_')}`;
  const root = assertOpenjocCacheChildPath(cacheRoot, join(cacheRoot, cacheKey));
  if (OPENJOC_SOURCE_PIN === null) {
    if (readGitHead(root) === null) {
      if (existsSync(root)) rmSync(assertOpenjocCacheChildPath(cacheRoot, root), {recursive: true, force: true});
      mkdirSync(dirname(root), {recursive: true});
      try {
        run('git', ['clone', '--no-tags', '--depth', '1', '--single-branch', '--branch', OPENJOC_SOURCE_REF, OPENJOC_REPOSITORY, root], browserRoot);
      } catch (error) {
        if (existsSync(root)) rmSync(assertOpenjocCacheChildPath(cacheRoot, root), {recursive: true, force: true});
        throw new Error(`failed to clone OpenJOC ${OPENJOC_SOURCE_REF}; set OPENJOC_ROOT or OPENJOC_SOURCE_PIN to select a compatible source checkout`, {cause: error});
      }
    } else {
      run('git', ['-C', root, 'fetch', '--no-tags', 'origin', OPENJOC_SOURCE_REF], browserRoot);
      run('git', ['-C', root, 'checkout', '--detach', 'FETCH_HEAD'], browserRoot);
    }
    return root;
  }
  if (!existsSync(join(root, '.git')) && readArchivePin(root) !== OPENJOC_SOURCE_PIN) {
    if (existsSync(root)) rmSync(assertOpenjocCacheChildPath(cacheRoot, root), {recursive: true, force: true});
    mkdirSync(dirname(root), {recursive: true});
    try {
      run('git', ['clone', '--no-tags', '--depth', '1', '--single-branch', '--branch', OPENJOC_SOURCE_REF, OPENJOC_REPOSITORY, root], browserRoot);
    } catch {
      if (existsSync(root)) rmSync(assertOpenjocCacheChildPath(cacheRoot, root), {recursive: true, force: true});
      console.warn('Git clone failed; fetching the same OpenJOC commit from its pinned GitHub archive');
      await downloadPinnedArchive(root);
    }
  }
  if (readGitHead(root) === OPENJOC_SOURCE_PIN || readArchivePin(root) === OPENJOC_SOURCE_PIN) return root;
  try {
    run('git', ['-C', root, 'fetch', '--no-tags', 'origin', OPENJOC_SOURCE_REF], browserRoot);
    run('git', ['-C', root, 'checkout', '--detach', OPENJOC_SOURCE_PIN], browserRoot);
  } catch {
    rmSync(assertOpenjocCacheChildPath(cacheRoot, root), {recursive: true, force: true});
    await downloadPinnedArchive(root);
  }
  return root;
}

async function downloadPinnedArchive(root) {
  const cacheRoot = resolve(browserRoot, '.cache', 'openjoc');
  const safeRoot = assertOpenjocCacheChildPath(cacheRoot, root);
  const cacheParent = dirname(safeRoot);
  const extractionRoot = assertOpenjocCacheChildPath(cacheRoot, join(cacheParent, `.extract-${process.pid}`));
  const archivePath = assertOpenjocCacheChildPath(cacheRoot, join(cacheParent, `${OPENJOC_SOURCE_PIN}.tar.gz`));
  mkdirSync(extractionRoot, {recursive: true});
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(OPENJOC_ARCHIVE_URL, {signal: controller.signal});
      if (!response.ok) throw new Error(`OpenJOC archive request returned status ${response.status}`);
      writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));
    } finally {
      clearTimeout(timeoutId);
    }
    run('tar', ['-xzf', archivePath, '-C', extractionRoot], browserRoot);
    const extracted = readdirSync(extractionRoot, {withFileTypes: true}).find((entry) => entry.isDirectory());
    if (extracted === undefined) throw new Error('OpenJOC archive did not contain a source directory');
    const extractedRoot = assertOpenjocCacheChildPath(cacheRoot, join(extractionRoot, extracted.name));
    renameSync(extractedRoot, safeRoot);
    writeFileSync(assertOpenjocCacheChildPath(cacheRoot, join(safeRoot, '.openjoc-source-pin')), `${OPENJOC_SOURCE_PIN}\n`);
  } finally {
    if (existsSync(archivePath)) rmSync(assertOpenjocCacheChildPath(cacheRoot, archivePath), {force: true});
    if (existsSync(extractionRoot)) rmSync(assertOpenjocCacheChildPath(cacheRoot, extractionRoot), {recursive: true, force: true});
  }
}

function readGitHead(root) {
  const result = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel', 'HEAD'], {encoding: 'utf8'});
  if (result.status !== 0) return null;
  const lines = result.stdout.trim().split(/\r?\n/);
  return resolve(lines[0] ?? '') !== resolve(root) ? null : lines[1] ?? null;
}

function assertPinnedCheckout(root) {
  if (!existsSync(join(root, 'Cargo.toml'))) {
    throw new Error(`OpenJOC source is missing Cargo.toml: ${root}`);
  }
  const actual = readGitHead(root);
  if (actual === OPENJOC_SOURCE_PIN || readArchivePin(root) === OPENJOC_SOURCE_PIN) return;
  if (actual !== null) throw new Error(`OpenJOC source pin mismatch: expected ${OPENJOC_SOURCE_PIN}, found ${actual}`);
  throw new Error(`OpenJOC source is not a pinned checkout or archive: ${root}`);
}

function assertGitCheckout(root) {
  if (!existsSync(join(root, 'Cargo.toml')) || readGitHead(root) === null) {
    throw new Error(`OpenJOC source is not a Git checkout: ${root}`);
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
