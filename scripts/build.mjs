// pattern: Imperative Shell

import {copyFileSync, mkdirSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const openjocRoot = process.env.OPENJOC_ROOT === undefined
  ? resolve(browserRoot, '..', 'OpenJOC')
  : resolve(process.env.OPENJOC_ROOT);
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const tsc = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';

function run(command, arguments_, cwd) {
  const isWindowsCommandScript = process.platform === 'win32' && command.endsWith('.cmd');
  const executable = isWindowsCommandScript ? (process.env.ComSpec ?? 'cmd.exe') : command;
  const commandArguments = isWindowsCommandScript
    ? ['/d', '/s', '/c', [command, ...arguments_].map(quoteWindowsArgument).join(' ')]
    : arguments_;
  const result = spawnSync(executable, commandArguments, {cwd, stdio: 'inherit'});
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function quoteWindowsArgument(argument) {
  return /[\s"]/.test(argument) ? `"${argument.replaceAll('"', '\\"')}"` : argument;
}

run(cargo, [
  'build',
  '--manifest-path', join(openjocRoot, 'Cargo.toml'),
  '-p', 'openjoc-wasm',
  '--target', 'wasm32-unknown-unknown',
  '--release',
  '--locked',
], openjocRoot);
run(tsc, ['-p', join(browserRoot, 'tsconfig.json')], browserRoot);

const wasmOutput = join(browserRoot, 'extension', 'wasm');
mkdirSync(wasmOutput, {recursive: true});
copyFileSync(
  join(openjocRoot, 'target', 'wasm32-unknown-unknown', 'release', 'openjoc_wasm.wasm'),
  join(wasmOutput, 'openjoc_wasm.wasm'),
);
