// pattern: Imperative Shell

import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createContentBundle} from './bundle-content.mjs';
import {createTypeScriptCommand} from './build-command.mjs';
import {resolveOpenjocRoot} from './openjoc-source.mjs';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const openjocRoot = await resolveOpenjocRoot();
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';

function run(command, arguments_, cwd) {
  const result = spawnSync(command, arguments_, {cwd, stdio: 'inherit'});
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(cargo, [
  'build',
  '--manifest-path', join(openjocRoot, 'Cargo.toml'),
  '-p', 'openjoc-wasm',
  '--target', 'wasm32-unknown-unknown',
  '--release',
  '--locked',
], openjocRoot);
const typeScriptCommand = createTypeScriptCommand(browserRoot, process.execPath);
run(typeScriptCommand.executable, typeScriptCommand.arguments, browserRoot);

writeFileSync(join(browserRoot, 'extension', 'bilibili-content.bundle.js'), createContentBundle(join(browserRoot, 'extension')));

const wasmOutput = join(browserRoot, 'extension', 'wasm');
mkdirSync(wasmOutput, {recursive: true});
copyFileSync(
  join(openjocRoot, 'target', 'wasm32-unknown-unknown', 'release', 'openjoc_wasm.wasm'),
  join(wasmOutput, 'openjoc_wasm.wasm'),
);
