// pattern: Imperative Shell

import {fetchCmafIndex} from '../src/cmaf-fetcher.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function run(): Promise<void> {
  const ranges: Array<string> = [];
  const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    ranges.push(headers.get('Range') ?? '');
    return new Response('', {status: 403});
  };
  let message = '';
  try {
    await fetchCmafIndex({
      url: 'https://upos-sz-example.bilivideo.com/audio.m4s?sig=secret',
      pageUrl: 'https://www.bilibili.com/video/BV1/',
      signal: new AbortController().signal,
      fetchImpl: fakeFetch,
    });
  } catch (error: unknown) {
    message = error instanceof Error ? error.message : '';
  }
  assert(message === 'Bilibili CMAF range request returned status 403 for bytes 0-8191', '403 is preserved at the range boundary');
  assert(ranges[0] === 'bytes=0-8191', 'initial range matches the observed bounded request');
}

await run();
