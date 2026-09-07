// pattern: Imperative Shell

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceRuntime} from './helpers/extension-runtime.mjs';

async function pendingIndexBody() {
  const timers = new Map();
  let sequence = 0;
  let signal;
  let rejectBody;
  let bodyStarted;
  const bodyReading = new Promise(resolve => {bodyStarted = resolve;});
  const body = new Promise((_resolve, reject) => {rejectBody = reject;});
  const runtime = createSourceRuntime({
    setTimeout(callback) {const id = ++sequence; timers.set(id, callback); return id;},
    clearTimeout(id) {timers.delete(id);},
  });
  const {fetchCmafIndex} = await runtime.load('cmaf-fetcher.js');
  const caller = new AbortController();
  const result = fetchCmafIndex({
    url: 'https://media.bilivideo.com/audio.m4s', pageUrl: 'https://www.bilibili.com/video/BVA/', signal: caller.signal,
    fetchImpl: async (_input, init) => {
      signal = init.signal;
      signal.addEventListener('abort', () => rejectBody(new Error('response body aborted')), {once: true});
      const response = new Response('', {status: 206, headers: {'content-range': 'bytes 0-8191/10000'}});
      response.arrayBuffer = () => {bodyStarted(); return body;};
      return response;
    },
  }).then(value => ({value}), error => ({error}));
  await bodyReading;
  return {
    caller, result, timers,
    get signal() {return signal;},
    async close() {rejectBody(new Error('test cleanup')); await result;},
  };
}

test('cancelling startup aborts a CMAF response body after its headers have arrived', async () => {
  const fetch = await pendingIndexBody();
  try {
    fetch.caller.abort();
    assert.equal(fetch.signal.aborted, true, 'the caller abort listener must remain attached through body consumption');
    const result = await fetch.result;
    assert.match(result.error?.message ?? '', /aborted/);
    assert.equal(fetch.timers.size, 0);
  } finally {await fetch.close();}
});

test('CMAF timeout also covers a stalled response body, not only response headers', async () => {
  const fetch = await pendingIndexBody();
  try {
    assert.equal(fetch.timers.size, 1, 'range timeout must stay armed until the body is consumed');
    for (const callback of fetch.timers.values()) callback();
    const result = await fetch.result;
    assert.match(result.error?.message ?? '', /timed out for bytes 0-8191/);
    assert.equal(fetch.signal.aborted, true);
    assert.equal(fetch.timers.size, 0);
  } finally {await fetch.close();}
});
