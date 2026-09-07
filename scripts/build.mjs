// pattern: Imperative Shell

import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
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

function stripModuleSyntax(source) {
  return source
    .replace(/^import[^\n]*\r?\n/gm, '')
    .replace(/^export\s+/gm, '');
}

function bundleContentScript() {
  const outputGain = stripModuleSyntax(readFileSync(join(browserRoot, 'extension', 'output-gain.js'), 'utf8'));
  const state = stripModuleSyntax(readFileSync(join(browserRoot, 'extension', 'joc-overlay-state.js'), 'utf8'));
  const startHandshake = stripModuleSyntax(readFileSync(join(browserRoot, 'extension', 'start-handshake.js'), 'utf8'));
  const protocol = stripModuleSyntax(readFileSync(join(browserRoot, 'extension', 'extension-protocol.js'), 'utf8'));
  const controller = stripModuleSyntax(readFileSync(join(browserRoot, 'extension', 'joc-overlay-controller.js'), 'utf8'));
  const content = stripModuleSyntax(readFileSync(join(browserRoot, 'extension', 'bilibili-content.js'), 'utf8'));
  const bundle = [
    `const __openjocOutputGain = (() => { ${outputGain} return {normalizeOutputGainDb, isOutputGainDb, OUTPUT_GAIN_MIN_DB, OUTPUT_GAIN_MAX_DB, OUTPUT_GAIN_STEP_DB}; })();`,
    `const __openjocOverlayState = (() => { const {normalizeOutputGainDb} = __openjocOutputGain; ${state} return {advanceOverlayState, createOverlayState, needsOverlayMarkupRebuild, overlayRendererLabel, resetOverlayState, OVERLAY_RENDERER_OPTIONS}; })();`,
    `const __openjocStartHandshake = (() => { ${startHandshake} return {acknowledgeStart, createStartHandshake, nextStartHandshakeAction, recordStartAttempt, shouldAcceptPlaybackStatus, shouldDispatchSessionRecovery, shouldExpirePlaybackStatus, shouldRestartAfterSeek}; })();`,
    `const __openjocExtensionProtocol = (() => { const {isOutputGainDb} = __openjocOutputGain; ${protocol} return {isRuntimeMessage}; })();`,
    `const __openjocOverlayController = (() => { const {normalizeOutputGainDb, OUTPUT_GAIN_MIN_DB, OUTPUT_GAIN_MAX_DB, OUTPUT_GAIN_STEP_DB} = __openjocOutputGain; const {advanceOverlayState, createOverlayState, needsOverlayMarkupRebuild, overlayRendererLabel, resetOverlayState, OVERLAY_RENDERER_OPTIONS} = __openjocOverlayState; ${controller} return {createJocOverlayController}; })();`,
    `(() => { const {normalizeOutputGainDb} = __openjocOutputGain; const {isRuntimeMessage} = __openjocExtensionProtocol; const {createJocOverlayController} = __openjocOverlayController; const {acknowledgeStart, createStartHandshake, nextStartHandshakeAction, recordStartAttempt, shouldAcceptPlaybackStatus, shouldDispatchSessionRecovery, shouldExpirePlaybackStatus, shouldRestartAfterSeek} = __openjocStartHandshake; ${content} })();`,
  ].join('\n\n');
  writeFileSync(join(browserRoot, 'extension', 'bilibili-content.bundle.js'), bundle);
}

bundleContentScript();

const wasmOutput = join(browserRoot, 'extension', 'wasm');
mkdirSync(wasmOutput, {recursive: true});
copyFileSync(
  join(openjocRoot, 'target', 'wasm32-unknown-unknown', 'release', 'openjoc_wasm.wasm'),
  join(wasmOutput, 'openjoc_wasm.wasm'),
);
