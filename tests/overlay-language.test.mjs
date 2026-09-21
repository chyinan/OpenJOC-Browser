// pattern: Imperative Shell

// The advanced panel owns the language choice: this test drives the real controller
// with a small DOM stand-in and checks the rendered markup in both languages.

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceRuntime} from './helpers/extension-runtime.mjs';

// src/ holds TypeScript, so the catalogue is loaded through the same runtime as the controller.
const i18n = await createSourceRuntime().load('joc-overlay-i18n.js');
const {overlayMessage} = i18n;

/** Every diagnostics group heading, keyed by the id renderDiagGroup receives. */
const DIAG_GROUP_KEYS = {decoder: 'diagGroupDecoder', input: 'diagGroupInput', profile: 'diagGroupProfile', audio: 'diagGroupAudio', realtime: 'diagGroupRealtime', memory: 'diagGroupMemory', binaural: 'diagGroupBinaural'};

/** Sorted, because the binaural group is appended next to the audio group. */
function diagGroupHeadings(language) {
  return Object.values(DIAG_GROUP_KEYS).map((key) => overlayMessage(language, key)).sort();
}

/** Reads the group headings out of the final markup, in render order. */
function renderedDiagGroupHeadings(markup) {
  return [...markup.matchAll(/<section class="diag-group"><h4>(.*?)<\/h4>/gu)].map((match) => match[1]);
}

function sortedRenderedDiagGroupHeadings(markup) {
  return renderedDiagGroupHeadings(markup).sort();
}

class FakeElement {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.dataset = {};
    this.hidden = false;
    this.textContent = '';
    this.markup = '';
    this.classList = {toggle() {}, add() {}, remove() {}};
    this.style = {setProperty() {}};
    this.listeners = new Map();
    this.children = [];
  }

  get innerHTML() {return this.markup;}
  set innerHTML(markup) {
    this.markup = markup;
    this.ownerDocument.panelMarkup = markup;
  }

  addEventListener(name, listener) {this.listeners.set(name, listener);}
  append(child) {this.children.push(child);}
  setAttribute() {}
  closest(selector) {return selector === '[data-action]' && this.dataset.action !== undefined ? this : null;}
  querySelector() {return null;}
  querySelectorAll() {return [];}

  attachShadow() {
    this.shadow = new FakeElement(this.ownerDocument);
    return this.shadow;
  }

  /** Replays the event the controller delegates on the panel body. */
  simulate(name, target) {
    const listener = this.listeners.get(name);
    assert.ok(listener, `the panel body listens for ${name}`);
    listener({target});
  }
}

class FakeSelectElement extends FakeElement {
  constructor(ownerDocument) {
    super(ownerDocument);
    this.value = '';
  }
}

function createFakeDocument() {
  const document = {
    panelMarkup: '',
    panelHost: null,
    panelBody: null,
    createElement() {return new FakeElement(document);},
    documentElement: {
      append(element) {
        document.panelHost = element;
        document.panelBody = element.shadow.children.at(-1);
      },
    },
    addEventListener() {},
  };
  return document;
}

function createCallbacks(changes) {
  return {
    onEnable() {}, onDisable() {}, onRendererChange() {}, onDialnormChange() {},
    onAlwaysEnabledChange() {}, onGainChange() {}, onReturnNative() {},
    onLanguageChange(language) {changes.push(language);},
  };
}

/** Stands in for the clicked advanced entry, which resolves through closest(). */
function createActionTarget(document, action) {
  const target = new FakeElement(document);
  target.dataset.action = action;
  return target;
}

function createLanguageField(document, language) {
  const field = new FakeSelectElement(document);
  field.dataset.field = 'language';
  field.value = language;
  return field;
}

test('the advanced panel switches the whole controller between supported languages', async () => {
  const document = createFakeDocument();
  const runtime = createSourceRuntime({document, window: {setTimeout() {return 1;}, clearTimeout() {}}, HTMLInputElement: FakeElement, HTMLSelectElement: FakeSelectElement, Element: FakeElement});
  const {createJocOverlayController} = await runtime.load('joc-overlay-controller.js');
  const changes = [];
  const controller = createJocOverlayController(createCallbacks(changes));
  assert.ok(document.panelBody, 'the controller renders its first markup');

  controller.setManifest(true);
  assert.ok(document.panelMarkup.includes('JOC 音频已检测'), 'the detection notice starts in Chinese');
  assert.ok(!document.panelMarkup.includes('JOC audio detected'), 'the default interface is not English');

  controller.setRequested(true);
  assert.ok(document.panelMarkup.includes('停用 OpenJOC'), 'the normal panel starts in Chinese');
  assert.ok(document.panelMarkup.includes('高级 <small>技术信息</small>'), 'the advanced entry keeps its Chinese design');
  assert.ok(document.panelMarkup.includes('校准（推荐）'), 'the program-level options start in Chinese');

  document.panelBody.simulate('click', createActionTarget(document, 'open-diagnostics'));
  assert.ok(document.panelMarkup.includes('高级诊断'), 'the optional language selector lives in the advanced panel');
  assert.ok(document.panelMarkup.includes('data-field="language"'), 'the advanced panel exposes the language selector');
  assert.ok(document.panelMarkup.includes('>语言 / Language</label>'), 'the default language selector is understandable before switching');
  assert.ok(document.panelMarkup.includes('<option value="zh-CN" selected>简体中文</option>'), 'Chinese is preselected');
  assert.ok(document.panelMarkup.includes('<option value="en">English</option>'), 'English is offered as a choice');
  assert.ok(document.panelMarkup.includes('切换控制器界面语言，并记住该选择。'), 'the language help text is translated');

  // A binaural renderer adds the conditional Binaural group, so all seven groups render here.
  controller.setRenderer('binaural-headphones');
  const chineseGroups = renderedDiagGroupHeadings(document.panelMarkup);
  assert.deepEqual(chineseGroups.slice(0, 4), ['解码器', '输入', '配置', '音频'], 'the first diagnostics group headings render in Chinese');
  assert.deepEqual(sortedRenderedDiagGroupHeadings(document.panelMarkup), diagGroupHeadings('zh-CN'), 'every diagnostics group heading renders in Chinese');
  for (const heading of ['Decoder', 'Input', 'Profile', 'Audio', 'Realtime', 'Memory', 'Binaural']) {
    assert.ok(!chineseGroups.includes(heading), `the Chinese interface does not fall back to the English ${heading} group heading`);
  }

  document.panelBody.simulate('change', createLanguageField(document, 'ja'));
  assert.deepEqual(changes, ['ja'], 'the Japanese language change is reported to the content script');
  assert.equal(JSON.parse(document.panelHost.dataset.openjocState).language, 'ja', 'the debug state follows the Japanese selection');
  assert.ok(document.panelMarkup.includes('詳細診断'), 'the advanced panel switches to Japanese');
  assert.ok(document.panelMarkup.includes('>言語</label>'), 'the Japanese language selector label is rendered');
  assert.ok(document.panelMarkup.includes('コントローラーの言語を切り替え、選択を記憶します。'), 'the Japanese help text is translated');
  assert.ok(document.panelMarkup.includes('<option value="ja" selected>日本語</option>'), 'the selector shows Japanese as active');
  assert.deepEqual(sortedRenderedDiagGroupHeadings(document.panelMarkup), diagGroupHeadings('ja'), 'every diagnostics group heading renders in Japanese');

  document.panelBody.simulate('change', createLanguageField(document, 'en'));
  assert.deepEqual(changes, ['ja', 'en'], 'the English language change is reported to the content script');
  assert.equal(JSON.parse(document.panelHost.dataset.openjocState).language, 'en', 'the debug state follows the selection');
  assert.ok(document.panelMarkup.includes('Hide advanced diagnostics'), 'the advanced panel switches to English');
  assert.ok(document.panelMarkup.includes('Calibrated (Recommended)'), 'the program-level options are translated');
  assert.ok(document.panelMarkup.includes('CURRENT AUDIO'), 'the audio heading is translated');
  assert.ok(!document.panelMarkup.includes('停用 OpenJOC'), 'no Chinese control label remains in English');
  assert.ok(document.panelMarkup.includes('Advanced diagnostics'), 'the advanced heading is translated');
  assert.ok(document.panelMarkup.includes('Switches the controller language and remembers the choice.'), 'the language help text switches language');
  assert.ok(document.panelMarkup.includes('<option value="en" selected>English</option>'), 'the selector shows the active language');
  assert.deepEqual(sortedRenderedDiagGroupHeadings(document.panelMarkup), diagGroupHeadings('en'), 'every diagnostics group heading renders in English');

  document.panelBody.simulate('change', createLanguageField(document, 'zh-CN'));
  assert.deepEqual(changes, ['ja', 'en', 'zh-CN'], 'switching back reports the Chinese choice');
  assert.ok(document.panelMarkup.includes('收起高级诊断'), 'the advanced panel returns to Chinese');
  assert.ok(document.panelMarkup.includes('高级诊断'), 'the advanced heading is Chinese again');
  assert.deepEqual(sortedRenderedDiagGroupHeadings(document.panelMarkup), diagGroupHeadings('zh-CN'), 'the diagnostics group headings return to Chinese');

  document.panelBody.simulate('change', createLanguageField(document, 'fr'));
  assert.deepEqual(changes, ['ja', 'en', 'zh-CN'], 'an unsupported value reports nothing');
  assert.ok(document.panelMarkup.includes('收起高级诊断'), 'an unsupported value keeps the current language');

  document.panelBody.simulate('click', createActionTarget(document, 'close-diagnostics'));
  assert.ok(document.panelMarkup.includes('停用 OpenJOC'), 'the normal panel is Chinese again');
  assert.ok(document.panelMarkup.includes('高级 <small>技术信息</small>'), 'the advanced entry is Chinese again');
});
