// pattern: Imperative Shell

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceRuntime} from './helpers/extension-runtime.mjs';

const joc = {data: {dash: {dolby: {audio: [{id: 1, codecs: 'ec-3', baseUrl: 'https://media.bilivideo.com/old.m4s'}]}}}};
const ordinary = {data: {dash: {audio: [{id: 2, codecs: 'mp4a.40.2', baseUrl: 'https://media.bilivideo.com/plain.m4s'}]}}};
const playurl = id => `https://api.bilibili.com/x/player/wbi/playurl?bvid=BV${id}&cid=${id}&avid=${id}`;

async function createBridge(options = {}) {
  const emitted = [];
  const fetched = [];
  const location = {href: 'https://www.bilibili.com/video/BVA/'};
  let resources = options.resources ?? [];
  let listener;
  let scan;
  let response = options.response ?? (() => new Response(JSON.stringify(joc)));
  const page = {
    __INITIAL_STATE__: {videoData: {bvid: 'BVA', aid: 'A', cid: 'A'}},
    __playinfo__: options.hasPayload === false ? undefined : options.payload ?? joc,
    addEventListener(_name, callback) {listener = callback;},
    setInterval(callback) {scan = callback; return 1;},
    postMessage(message) {emitted.push(message);},
  };
  const runtime = createSourceRuntime({
    window: page, location,
    performance: {getEntriesByType: () => resources.map(name => ({name}))},
    async fetch(url, init) {fetched.push(String(url)); return response(String(url), init);},
  });
  await runtime.load('bilibili-main-bridge.js');
  return {
    emitted, fetched, page,
    navigate(id, payload, nextResources = []) {
      location.href = `https://www.bilibili.com/video/BV${id}/`;
      page.__INITIAL_STATE__ = {videoData: {bvid: `BV${id}`, aid: id, cid: id}};
      page.__playinfo__ = payload;
      resources = nextResources;
    },
    changeRouteOnly(id) {location.href = `https://www.bilibili.com/video/BV${id}/`;},
    setResources(values) {resources = values;},
    setPart(part) {location.href = `${location.href.split('?')[0]}?p=${part}`;},
    respondWith(callback) {response = callback;},
    scan() {scan();},
    force() {listener({source: page, data: {source: 'openjoc-content', type: 'request-manifest'}});},
    range(url) {listener({source: page, data: {source: 'openjoc-content', type: 'fetch-media-range', requestId: 'range-1', url, start: 0, end: 1}});},
  };
}

test('initial JOC bootstrap remains available without a playurl resource entry', async () => {
  const bridge = await createBridge();
  assert.ok(bridge.emitted.some(message => message.type === 'manifest' && message.mediaKey.bvid === 'BVA'));
});

test('a new ordinary video cannot inherit the previous global playinfo audio', async () => {
  const bridge = await createBridge();
  bridge.navigate('B', joc);
  bridge.force();
  assert.equal(bridge.emitted.filter(message => message.type === 'manifest' && message.mediaKey.bvid === 'BVB').length, 0);
  assert.ok(bridge.emitted.some(message => message.type === 'unavailable' && message.pageUrl.includes('/BVB/')));
});

test('a route change cannot publish the old initial-state identity under the new page URL', async () => {
  const bridge = await createBridge();
  bridge.changeRouteOnly('B');
  bridge.force();
  assert.equal(bridge.emitted.filter(message => message.type === 'manifest' && message.pageUrl.includes('/BVB/')).length, 0);
});

test('a previous video playurl resource is not refetched for the new ordinary video', async () => {
  const bridge = await createBridge();
  bridge.navigate('B', ordinary, [playurl('A')]);
  bridge.force();
  await new Promise(setImmediate);
  assert.equal(bridge.fetched.includes(playurl('A')), false);
  assert.equal(bridge.emitted.filter(message => message.type === 'manifest' && message.mediaKey.bvid === 'BVB').length, 0);
});

test('an authoritative ordinary playurl response wins over stale JOC globals', async () => {
  const bridge = await createBridge();
  bridge.navigate('B', joc, [playurl('B')]);
  bridge.respondWith(() => new Response(JSON.stringify(ordinary)));
  bridge.force();
  await new Promise(setImmediate);
  assert.ok(bridge.fetched.includes(playurl('B')));
  assert.equal(bridge.emitted.filter(message => message.type === 'manifest' && message.mediaKey.bvid === 'BVB').length, 0);
  assert.ok(bridge.emitted.some(message => message.type === 'unavailable' && message.pageUrl.includes('/BVB/')));
});

test('a late old playurl response cannot acquire the next video identity', async () => {
  let finishOld;
  const oldResponse = new Promise(resolve => {finishOld = resolve;});
  const bridge = await createBridge({hasPayload: false, resources: [playurl('A')], response: () => oldResponse});
  bridge.navigate('B', ordinary, [playurl('A'), playurl('B')]);
  bridge.respondWith(() => new Response(JSON.stringify(ordinary)));
  bridge.force();
  finishOld(new Response(JSON.stringify(joc)));
  await new Promise(setImmediate);
  assert.equal(bridge.emitted.filter(message => message.type === 'manifest' && message.mediaKey.bvid === 'BVB').length, 0);
});

test('the next JOC video is accepted only through its matching playurl request', async () => {
  const bridge = await createBridge();
  bridge.navigate('B', joc, [playurl('B')]);
  bridge.respondWith(() => new Response(JSON.stringify({data: {dash: {dolby: {audio: [{id: 1, codecs: 'ec-3', baseUrl: 'https://media.bilivideo.com/new.m4s'}]}}}})));
  bridge.force();
  await new Promise(setImmediate);
  const next = bridge.emitted.find(message => message.type === 'manifest' && message.mediaKey.bvid === 'BVB');
  assert.equal(next?.candidates[0]?.baseUrl, 'https://media.bilivideo.com/new.m4s');
});

test('old media range permissions are removed when navigation leaves the JOC item', async () => {
  const bridge = await createBridge();
  bridge.navigate('B', ordinary);
  bridge.force();
  bridge.range('https://media.bilivideo.com/old.m4s');
  await new Promise(setImmediate);
  assert.equal(bridge.fetched.includes('https://media.bilivideo.com/old.m4s'), false);
});

test('matching request identity can identify the next JOC item while initial state still belongs to the old page', async () => {
  const bridge = await createBridge();
  bridge.changeRouteOnly('B');
  bridge.setResources([`${playurl('B')}&p=1`]);
  bridge.respondWith(() => new Response(JSON.stringify({data: {dash: {dolby: {audio: [{id: 1, codecs: 'ec-3', baseUrl: 'https://media.bilivideo.com/new.m4s'}]}}}})));
  bridge.force();
  await new Promise(setImmediate);
  const next = bridge.emitted.find(message => message.type === 'manifest' && message.mediaKey.bvid === 'BVB');
  assert.equal(next?.mediaKey.aid, 'B');
  assert.equal(next?.candidates[0]?.baseUrl, 'https://media.bilivideo.com/new.m4s');
});

test('request identity for part one cannot identify an ordinary part two while initial state is stale', async () => {
  const bridge = await createBridge();
  bridge.changeRouteOnly('B'); bridge.setResources([playurl('B')]); bridge.force();
  await new Promise(setImmediate);
  const baseline = bridge.emitted.length;
  bridge.setPart(2); bridge.force();
  await new Promise(setImmediate);
  assert.equal(bridge.emitted.slice(baseline).filter(message => message.type === 'manifest').length, 0);
});

for (const hasPayload of [true, false]) {
  test(`returning to an ordinary initial route cannot capture a later JOC bootstrap (initial payload: ${hasPayload})`, async () => {
    const bridge = await createBridge({hasPayload, payload: ordinary, resources: [playurl('A')], response: () => new Response(JSON.stringify(ordinary))});
    await new Promise(setImmediate);
    bridge.navigate('B', joc, [playurl('B')]);
    bridge.respondWith(() => new Response(JSON.stringify(joc)));
    bridge.force(); await new Promise(setImmediate);
    const baseline = bridge.emitted.length;
    bridge.navigate('A', joc, [playurl('A')]);
    bridge.respondWith(() => new Response('', {status: 403}));
    bridge.force(); await new Promise(setImmediate);
    assert.equal(bridge.emitted.slice(baseline).filter(message => message.type === 'manifest').length, 0);
  });
}

test('part two cannot fall back to videoData first-part CID when its page entry is missing', async () => {
  const bridge = await createBridge();
  bridge.navigate('B', joc, [playurl('B')]); bridge.setPart(2); bridge.force();
  await new Promise(setImmediate);
  assert.equal(bridge.emitted.filter(message => message.type === 'manifest' && message.pageUrl.includes('?p=2')).length, 0);
});

test('a known second-part CID accepts its own playurl without requiring a redundant p parameter', async () => {
  const bridge = await createBridge();
  bridge.navigate('B', joc, [playurl('B').replace('cid=B', 'cid=C')]);
  bridge.page.__INITIAL_STATE__.videoData.pages = [{cid: 'B'}, {cid: 'C'}];
  bridge.setPart(2); bridge.force();
  await new Promise(setImmediate);
  const next = bridge.emitted.find(message => message.type === 'manifest' && message.pageUrl.includes('?p=2'));
  assert.equal(next?.mediaKey.cid, 'C');
});

test('an unlabelled resource left by part two must not be assumed to belong to part one', async () => {
  const bridge = await createBridge();
  bridge.changeRouteOnly('B'); bridge.setPart(2); bridge.setResources([playurl('B')]);
  bridge.force(); await new Promise(setImmediate);
  const baseline = bridge.emitted.length;
  bridge.setPart(1); bridge.force(); await new Promise(setImmediate);
  assert.equal(bridge.emitted.slice(baseline).filter(message => message.type === 'manifest').length, 0);
});
