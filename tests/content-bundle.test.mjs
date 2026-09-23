// pattern: Imperative Shell

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import vm from 'node:vm';

import {createContentBundle} from '../scripts/bundle-content.mjs';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Compiles src/ to a temporary directory because extension/*.js is a build output. */
function compileSources(targetDirectory) {
  const result = spawnSync(process.execPath, [join(browserRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(browserRoot, 'tsconfig.json'), '--outDir', targetDirectory], {cwd: browserRoot, encoding: 'utf8'});
  assert.equal(result.status, 0, `the extension sources compile: ${result.stdout}${result.stderr}`);
}

function contentScriptGlobals() {
  const element = () => ({
    dataset: {}, className: '', hidden: false, innerHTML: '', textContent: '', style: {},
    classList: {toggle() {}, add() {}, remove() {}}, addEventListener() {}, append() {}, setAttribute() {},
    attachShadow() {return element();}, querySelector() {return null;}, querySelectorAll() {return [];},
  });
  const listeners = [];
  return {
    document: {
      visibilityState: 'visible',
      createElement: element,
      documentElement: element(),
      querySelectorAll() {return [];},
      addEventListener() {},
    },
    window: {
      addEventListener(name, listener) {listeners.push({name, listener});},
      postMessage() {},
      setInterval() {return 1;},
      clearTimeout() {},
      setTimeout() {return 1;},
    },
    location: {href: 'https://www.bilibili.com/video/BV1'},
    performance: {now: () => 0},
    navigator: {},
    console: {info() {}},
    chrome: {
      runtime: {
        id: 'test',
        onMessage: {addListener() {}},
        sendMessage: async () => undefined,
      },
      storage: {local: {get: async () => ({}), set: async () => undefined}},
    },
  };
}

test('the content-script bundle wires the compiled modules into one classic script', () => {
  const target = mkdtempSync(join(tmpdir(), 'openjoc-bundle-'));
  try {
    compileSources(target);
    const bundle = createContentBundle(target);

    for (const iife of ['__openjocOutputGain', '__openjocOverlayI18n', '__openjocHrtfPresets', '__openjocOverlayState', '__openjocStartHandshake', '__openjocExtensionProtocol', '__openjocOverlayController']) {
      assert.ok(bundle.includes(`const ${iife} = (() => {`), `${iife} is defined by the bundle`);
    }
    const controllerStart = bundle.indexOf('const __openjocOverlayController = (() => {');
    const controllerEnd = bundle.indexOf('\n\n(() => {', controllerStart);
    const controllerIife = bundle.slice(controllerStart, controllerEnd);
    assert.match(controllerIife, /const \{[^}]*normalizeOverlayLanguage[^}]*\} = __openjocOverlayI18n;/u, 'the controller bundle receives the language normalizer it calls during select changes');
    assert.doesNotMatch(controllerIife, /escapeHtml\(availability\)/u, 'HRTF option labels do not append availability text');
    assert.doesNotMatch(controllerIife, /hrtfAvailable/u, 'the HRTF selector has no offline availability text');
    assert.doesNotMatch(controllerIife, /hrtfOfflineHelp/u, 'the HRTF selector does not render an extra helper paragraph');
    assert.ok(bundle.includes('class="field-block hrtf-field-block"'), 'the nested HRTF selector has an explicit alignment scope');
    assert.ok(bundle.includes('.format-block > .hrtf-field-block { margin-left: -16px; margin-right: -16px; }'), 'the HRTF field cancels the parent inset so its title and select align with output mode');
    assert.ok(!/\bimport\b|\bexport\b/u.test(bundle), 'the bundle keeps no module syntax for a classic content script');
    assert.ok(readFileSync(join(target, 'joc-overlay-i18n.js'), 'utf8').length > 0, 'the interface catalogues compile with the rest of the sources');
  } finally {
    rmSync(target, {recursive: true, force: true});
  }
});

test('the content-script bundle initializes against a page with both interface languages', () => {
  const target = mkdtempSync(join(tmpdir(), 'openjoc-bundle-'));
  try {
    compileSources(target);
    const bundle = createContentBundle(target);
    const globals = contentScriptGlobals();
    const context = vm.createContext({...globals, URL, crypto, performance, setTimeout, clearTimeout, console});
    assert.doesNotThrow(() => new vm.Script(bundle).runInContext(context), 'every module dependency resolves when the content script loads');
    const i18n = new vm.Script('__openjocOverlayI18n').runInContext(context);
    for (const key of ['panelAriaLabel', 'languageField', 'advancedDiagnostics', 'alwaysEnableOpenJoc']) {
      assert.equal(typeof i18n.overlayMessage('en', key), 'string', `${key} is available to the shipped controller`);
      assert.equal(typeof i18n.overlayMessage('zh-CN', key), 'string', `${key} is available in Chinese too`);
      assert.equal(typeof i18n.overlayMessage('ja', key), 'string', `${key} is available in Japanese too`);
    }
    assert.equal(i18n.overlayMessage('en', 'languageField'), 'Language', 'the shipped bundle carries the English catalogue');
    assert.equal(i18n.overlayMessage('zh-CN', 'languageField'), '语言 / Language', 'the shipped bundle carries the bilingual default language label');
    assert.equal(i18n.overlayMessage('ja', 'languageField'), '言語', 'the shipped bundle carries the Japanese catalogue');
  } finally {
    rmSync(target, {recursive: true, force: true});
  }
});
