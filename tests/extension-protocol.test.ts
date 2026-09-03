// pattern: Functional Core

import {isMainBridgeMessage, isRuntimeMessage} from '../src/extension-protocol.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  const candidate = {
    id: 'dolby-1',
    source: 'dolby',
    codecs: 'ec-3',
    mimeType: 'audio/mp4',
    bandwidth: 128_000,
    baseUrl: 'https://upos-sz-example.bilivideo.com/audio.m4s?sig=secret',
    backupUrls: [],
  };
  const mediaKey = {bvid: 'BV1', aid: '1', cid: '2'};
  assert(isMainBridgeMessage({source: 'openjoc-bilibili', type: 'manifest', pageOrigin: 'https://www.bilibili.com', pageUrl: 'https://www.bilibili.com/video/BV1/', mediaKey, candidates: [candidate]}), 'valid main manifest is accepted');
  assert(!isMainBridgeMessage({source: 'openjoc-bilibili', type: 'manifest', pageOrigin: 'https://evil.example', pageUrl: 'https://evil.example/', mediaKey, candidates: [candidate]}), 'wrong main origin is rejected');
  assert(isRuntimeMessage({target: 'background', type: 'toggle'}), 'valid toggle is accepted');
  assert(isRuntimeMessage({target: 'background', type: 'page-media-range-request', tabId: 1, generation: 1, requestId: 'r1', url: 'https://upos-sz-example.bilivideo.com/audio.m4s', start: 0, end: 8191}), 'bounded page range request is accepted');
  assert(!isRuntimeMessage({target: 'background', type: 'page-media-range-request', tabId: 1, generation: 1, requestId: 'r1', url: 'https://upos-sz-example.bilivideo.com/audio.m4s', start: 0, end: 4 * 1024 * 1024}), 'oversized page range request is rejected');
  assert(!isRuntimeMessage({target: 'offscreen', type: 'fetch', url: 'https://evil.example'}), 'arbitrary fetch message is rejected');
}

run();
