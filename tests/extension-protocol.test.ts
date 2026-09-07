// pattern: Functional Core

import {isLegacyOffscreenStatus, isMainBridgeMessage, isRuntimeMessage} from '../src/extension-protocol.js';

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
  assert(isRuntimeMessage({target: 'background', type: 'session-heartbeat', requestId: 'start-1', pageUrl: 'https://www.bilibili.com/video/BV1/', mediaKey, generation: 1}), 'request-scoped session heartbeat is accepted');
  assert(!isRuntimeMessage({target: 'background', type: 'session-heartbeat', pageUrl: 'https://www.bilibili.com/video/BV1/', mediaKey, generation: 1}), 'a heartbeat without a request identity is rejected');
  assert(isRuntimeMessage({target: 'background', type: 'disable', mediaKey, generation: 1}), 'media-scoped disable is accepted');
  assert(!isRuntimeMessage({target: 'background', type: 'disable', generation: 1}), 'unscoped disable is rejected');
  assert(isRuntimeMessage({target: 'offscreen', type: 'disable', tabId: 1, mediaKey, generation: 1}), 'media-scoped offscreen disable is accepted');
  assert(isRuntimeMessage({target: 'background', type: 'request-session'}), 'session recovery request is accepted');
  assert(isRuntimeMessage({target: 'background', type: 'request-session', force: true}), 'forced session recovery request is accepted');
  assert(isRuntimeMessage({target: 'background', type: 'request-session', force: true, requestId: 'start-1', generation: 3}), 'request-scoped recovery includes a valid generation');
  assert(!isRuntimeMessage({target: 'background', type: 'request-session', force: true, requestId: '', generation: -1}), 'malformed recovery identity and generation are rejected');
  assert(!isRuntimeMessage({target: 'background', type: 'request-session', force: 'yes'}), 'invalid forced session recovery flag is rejected');
  assert(isRuntimeMessage({target: 'background', type: 'page-media-range-response', tabId: 1, generation: 1, requestId: 'r1', status: 206, contentRange: 'bytes 0-2/3', error: null, bufferBase64: 'AQI='}), 'base64 page range response is accepted');
  assert(!isRuntimeMessage({target: 'background', type: 'page-media-range-response', tabId: 1, generation: 1, requestId: 'r1', status: 206, contentRange: 'bytes 0-2/3', error: null, bufferBase64: 'not base64'}), 'malformed base64 page range response is rejected');
  assert(isRuntimeMessage({target: 'background', type: 'page-media-range-request', tabId: 1, generation: 1, requestId: 'r1', url: 'https://upos-sz-example.bilivideo.com/audio.m4s', start: 0, end: 8191}), 'bounded page range request is accepted');
  assert(!isRuntimeMessage({target: 'background', type: 'page-media-range-request', tabId: 1, generation: 1, requestId: 'r1', url: 'https://upos-sz-example.bilivideo.com/audio.m4s', start: 0, end: 4 * 1024 * 1024}), 'oversized page range request is rejected');
  assert(!isRuntimeMessage({target: 'offscreen', type: 'fetch', url: 'https://evil.example'}), 'arbitrary fetch message is rejected');
  assert(isLegacyOffscreenStatus({target: 'background', type: 'offscreen-status', tabId: 1, generation: 9}), 'status without request identity is detected as a stale offscreen protocol');
  assert(!isLegacyOffscreenStatus({target: 'background', type: 'offscreen-status', requestId: 'request-1', tabId: 1, generation: 9}), 'status with request identity is not treated as legacy');
}

run();
