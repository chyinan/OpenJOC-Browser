// pattern: Imperative Shell

import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {resolveOpenjocRoot} from './openjoc-source.mjs';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const openjocRoot = await resolveOpenjocRoot();
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const result = spawnSync(cargo, [
  'check',
  '--manifest-path', join(openjocRoot, 'Cargo.toml'),
  '-p', 'openjoc-wasm',
  '--target', 'wasm32-unknown-unknown',
], {cwd: openjocRoot, stdio: 'inherit'});
if (result.error !== undefined) {
  throw result.error;
}
process.exit(result.status ?? 1);
