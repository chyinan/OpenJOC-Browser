// pattern: Functional Core

import {isRuntimeMessage} from '../src/extension-protocol.js';
import {advanceOverlayState, createOverlayState, OVERLAY_RENDERER_OPTIONS} from '../src/joc-overlay-state.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  const binauralOption = OVERLAY_RENDERER_OPTIONS.find((option) => option.renderer === 'binaural-headphones');
  assert(binauralOption?.enabled === true, 'Binaural renderer is an explicit available option');
  assert(binauralOption?.label === 'Binaural (Headphones)', 'Binaural renderer uses the factual user-facing label');

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
    dialnorm: 'calibrated',
    renderer: 'binaural',
  };
  assert(isRuntimeMessage(startMessage), 'renderer-aware start message is accepted');

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
    dialnorm: 'calibrated',
    renderer: 'binaural',
  };
  assert(isRuntimeMessage(offscreenStartMessage), 'renderer-aware offscreen start message is accepted');
}

run();
