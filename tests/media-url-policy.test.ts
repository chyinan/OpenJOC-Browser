// pattern: Functional Core

import {isAllowedBilibiliMediaUrl, sanitizeMediaUrl} from '../src/media-url-policy.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  assert(isAllowedBilibiliMediaUrl('https://upos-sz-example.bilivideo.com/path/audio.m4s?sig=secret', 'https://www.bilibili.com/video/BV1/'), 'approved bilivideo m4s is allowed');
  assert(!isAllowedBilibiliMediaUrl('http://upos-sz-example.bilivideo.com/path/audio.m4s', 'https://www.bilibili.com/video/BV1/'), 'non-HTTPS media is rejected');
  assert(!isAllowedBilibiliMediaUrl('https://evil.example/path/audio.m4s', 'https://www.bilibili.com/video/BV1/'), 'unapproved host is rejected');
  assert(!isAllowedBilibiliMediaUrl('https://upos-sz-example.bilivideo.com/path/audio.mp4', 'https://www.bilibili.com/video/BV1/'), 'unapproved extension is rejected');
  assert(!isAllowedBilibiliMediaUrl('https://user:pass@upos-sz-example.bilivideo.com/path/audio.m4s', 'https://www.bilibili.com/video/BV1/'), 'credential-bearing URL is rejected');
  assert(sanitizeMediaUrl('https://upos-sz-example.bilivideo.com/path/audio.m4s?sig=secret') === 'https://upos-sz-example.bilivideo.com/path/audio.m4s', 'diagnostics redact signed query');
}

run();
