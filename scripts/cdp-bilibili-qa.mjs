// pattern: Imperative Shell

const port = Number(process.argv[2] ?? 9230);
const browserName = process.argv[3] ?? 'Edge';

class CdpConnection {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, {once: true});
      this.socket.addEventListener('error', reject, {once: true});
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (pending === undefined) return;
        this.pending.delete(message.id);
        if (message.error === undefined) pending.resolve(message.result);
        else pending.reject(new Error(JSON.stringify(message.error)));
      } else {
        this.events.push(message);
      }
    });
  }

  command(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({id, method, params}));
    return new Promise((resolve, reject) => this.pending.set(id, {resolve, reject}));
  }

  close() {
    this.socket.close();
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`CDP endpoint failed: ${response.status}`);
  return response.json();
}

async function evaluate(connection, expression) {
  const result = await connection.command('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.text ?? 'runtime evaluation failed');
  return result.result?.value;
}

async function waitFor(connection, expression, description, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(connection, expression)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function flattenedNodes(connection) {
  const result = await connection.command('DOM.getFlattenedDocument', {depth: -1, pierce: true});
  return result.nodes ?? [];
}

function nodeAttributes(node) {
  const values = new Map();
  for (let index = 0; index < (node.attributes?.length ?? 0); index += 2) {
    values.set(node.attributes[index], node.attributes[index + 1]);
  }
  return values;
}

const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
const target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith('https://www.bilibili.com/video/'));
if (target === undefined) {
  console.log(JSON.stringify({browser: browserName, result: 'PENDING_NO_BILIBILI_TARGET'}));
  process.exit(0);
}

const connection = new CdpConnection(target.webSocketDebuggerUrl);
await connection.connect();
await connection.command('Runtime.enable');
await connection.command('Log.enable');
await connection.command('Page.enable');
await connection.command('DOM.enable');
const loaded = await waitFor(connection, "document.readyState === 'complete'", 'Bilibili document');
const observation = await evaluate(connection, `({
  readyState: document.readyState,
  title: document.title,
  url: location.href,
  videos: [...document.querySelectorAll('video')].map((video) => ({readyState: video.readyState, duration: video.duration, paused: video.paused, currentTime: video.currentTime})),
  openjocOverlay: document.querySelector('[data-openjoc="control"]') !== null,
  initialState: typeof window.__INITIAL_STATE__ === 'object' && window.__INITIAL_STATE__ !== null,
  playInfo: typeof window.__playinfo__ === 'object' && window.__playinfo__ !== null,
})`);
const overlayLoaded = await waitFor(connection, "document.querySelector('[data-openjoc=\\\"control\\\"]') !== null", 'OpenJOC Bilibili overlay', 15_000);
let rendererSelection = null;
let diagnosticsText = [];
if (overlayLoaded) {
  const nodes = await flattenedNodes(connection);
  const rendererNode = nodes.find((node) => node.nodeName === 'SELECT' && nodeAttributes(node).get('data-field') === 'renderer');
  if (rendererNode?.backendNodeId !== undefined) {
    const resolved = await connection.command('DOM.resolveNode', {backendNodeId: rendererNode.backendNodeId});
    const objectId = resolved.object?.objectId;
    if (objectId !== undefined) {
      await connection.command('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: "function(){ this.value = 'binaural-headphones'; this.dispatchEvent(new Event('change', {bubbles:true})); return this.value; }",
        returnByValue: true,
      });
      rendererSelection = await evaluateResolved(connection, objectId, 'function(){ return this.value; }');
    }
  }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const currentNodes = await flattenedNodes(connection);
    diagnosticsText = currentNodes
      .filter((node) => node.nodeName === 'SELECT' || typeof node.nodeValue === 'string' && (node.nodeValue.includes('Binaural') || node.nodeValue.includes('7.1.4') || node.nodeValue.includes('SADIE')))
      .map((node) => ({nodeName: node.nodeName, nodeValue: node.nodeValue ?? null, attributes: node.attributes ?? [], backendNodeId: node.backendNodeId ?? null}));
    if (diagnosticsText.some((value) => value.nodeValue?.includes('Binaural')) && diagnosticsText.some((value) => value.nodeValue?.includes('7.1.4'))) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
const finalObservation = await evaluate(connection, "({openjocOverlay: document.querySelector('[data-openjoc=\\\"control\\\"]') !== null, videos: [...document.querySelectorAll('video')].map((video) => ({readyState: video.readyState, duration: video.duration, paused: video.paused, currentTime: video.currentTime}))})");
const errors = connection.events.filter((event) => {
  if (event.method === 'Runtime.exceptionThrown') return true;
  if (event.method !== 'Log.entryAdded' || event.params?.entry?.level !== 'error') return false;
  const text = event.params?.entry?.text ?? '';
  return event.params?.entry?.source !== 'network' && !text.includes('biliapi.net/socket.io');
});
connection.close();
console.log(JSON.stringify({browser: browserName, loaded, overlayLoaded, target: target.url, observation, rendererSelection, diagnosticsText, finalObservation, errors}));
if (errors.length > 0) process.exit(1);

async function evaluateResolved(connection, objectId, functionDeclaration) {
  const result = await connection.command('Runtime.callFunctionOn', {objectId, functionDeclaration, returnByValue: true});
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.text ?? 'resolved node evaluation failed');
  return result.result?.value;
}
