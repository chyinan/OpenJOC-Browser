// pattern: Functional Core

import {isRuntimeMessage} from '../src/extension-protocol.js';
import {advanceOverlayState, createOverlayState, OVERLAY_RENDERER_OPTIONS} from '../src/joc-overlay-state.js';
import {HRTF_PRESET_OPTIONS, HRTF_SELECTION_OPTIONS, hrtfRendererCacheKey, normalizeHrtfSelection} from '../src/hrtf-presets.js';
import {supportsCustomSofaAbi, supportsExternalHrtfAssetAbi} from '../src/wasm-bindings.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  const legacyWasm = {exports: {openjoc_wasm_decoder_create_with_renderer_and_hrtf: (): number => 1}} as unknown as WebAssembly.Instance;
  const assetWasm = {exports: {openjoc_wasm_decoder_create_with_renderer_and_hrtf_asset: (): number => 1}} as unknown as WebAssembly.Instance;
  const customSofaWasm = {exports: {
    openjoc_wasm_custom_sofa_alloc: (): number => 1,
    openjoc_wasm_decoder_create_with_renderer_and_custom_sofa: (): number => 1,
  }} as unknown as WebAssembly.Instance;
  assert(!supportsExternalHrtfAssetAbi(legacyWasm), 'legacy embedded WASM uses its built-in preset path');
  assert(supportsExternalHrtfAssetAbi(assetWasm), 'external-asset WASM uses the selected packaged resource');
  assert(supportsCustomSofaAbi(customSofaWasm), 'WASM exposes the local custom SOFA construction path');
  assert(!supportsCustomSofaAbi(assetWasm), 'built-in assets alone do not enable Custom SOFA');

  const binauralOption = OVERLAY_RENDERER_OPTIONS.find((option) => option.renderer === 'binaural-headphones');
  assert(binauralOption?.enabled === true, 'Binaural renderer is an explicit available option');
  assert(binauralOption?.label === 'Binaural (Headphones)', 'Binaural renderer uses the factual user-facing label');
  assert(HRTF_PRESET_OPTIONS.length === 2, 'only D1 and D2 built-in HRTF profiles are exposed');
  assert(HRTF_PRESET_OPTIONS[0]?.id === 'sadie-ii-d1-ku100', 'D1 remains the browser HRTF default');
  assert(HRTF_PRESET_OPTIONS[1]?.id === 'sadie-ii-d2-kemar', 'D2 remains the second built-in HRTF');
  assert(HRTF_SELECTION_OPTIONS[2]?.id === 'custom-sofa', 'Custom SOFA appears after the built-in HRTFs');
  assert(normalizeHrtfSelection('custom-sofa') === 'custom-sofa', 'Custom SOFA selection is retained without becoming a built-in asset');
  assert(hrtfRendererCacheKey('custom-sofa', 'a'.repeat(64)) !== hrtfRendererCacheKey('custom-sofa', 'b'.repeat(64)), 'different imported SOFA contents have distinct renderer identities');
  assert(hrtfRendererCacheKey('sadie-ii-d1-ku100', null) === 'sadie-ii-d1-ku100', 'built-in renderer identities remain stable');

  const rendererState = advanceOverlayState(
    createOverlayState(),
    {type: 'set-renderer', renderer: 'binaural-headphones'},
  );
  assert(rendererState.renderer === 'binaural-headphones', 'Binaural renderer selection is retained');

  const startMessage = {
    target: 'background',
    type: 'start',
    requestId: 'request-1',
    pageUrl: 'https://www.bilibili.com/video/BV1/',
    mediaKey: {bvid: 'BV1', aid: '1', cid: '2'},
    candidates: [],
    generation: 1,
    videoTimeSamples: 0,
    paused: false,
    buffering: false,
    dialnorm: 'calibrated',
    renderer: 'binaural',
  };
  assert(isRuntimeMessage(startMessage), 'renderer-aware start message is accepted');
  assert(isRuntimeMessage({...startMessage, hrtf: 'custom-sofa', hrtfRevision: 'a'.repeat(64)}), 'custom SOFA start message is accepted with its verified asset identity');
  assert(!isRuntimeMessage({...startMessage, hrtf: 'custom-sofa'}), 'custom SOFA start without an integrity identity is rejected');

  const offscreenStartMessage = {
    target: 'offscreen',
    type: 'start',
    requestId: 'request-1',
    tabId: 1,
    pageUrl: 'https://www.bilibili.com/video/BV1/',
    mediaKey: {bvid: 'BV1', aid: '1', cid: '2'},
    candidate: {
      id: 'dolby-1',
      source: 'dolby',
      codecs: 'ec-3',
      mimeType: 'audio/mp4',
      bandwidth: 128_000,
      baseUrl: 'https://upos-sz-example.bilivideo.com/audio.m4s',
      backupUrls: [],
    },
    generation: 1,
    videoTimeSamples: 0,
    paused: false,
    buffering: false,
    dialnorm: 'calibrated',
    renderer: 'binaural',
  };
  assert(isRuntimeMessage(offscreenStartMessage), 'renderer-aware offscreen start message is accepted');
}

run();
