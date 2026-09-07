// pattern: Imperative Shell

import {readFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? 9226);
const browserName = process.argv[3] ?? 'Chromium';
const requestedExtensionId = process.argv[4];
const fixture = resolve(process.argv[5] ?? join(browserRoot, 'fixtures', 'joc.lifecycle.ec3'));
const reopenFixture = resolve(process.argv[6] ?? join(browserRoot, 'fixtures', 'joc.ec3'));
const expectError = process.argv[7] === '--expect-error';
const requestedRenderer = process.argv.includes('--binaural') ? 'binaural' : 'stereo';
const expectedLifecycleSamples = requestedRenderer === 'binaural' ? 196863 : 196640;
const expectedReopenSamples = requestedRenderer === 'binaural' ? 1791 : 1568;
const errors = [];

class CdpConnection {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener('open', resolveOpen, {once: true});
      this.socket.addEventListener('error', rejectOpen, {once: true});
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (pending === undefined) {
          return;
        }
        this.pending.delete(message.id);
        if (message.error !== undefined) {
          pending.reject(new Error(JSON.stringify(message.error)));
        } else {
          pending.resolve(message.result);
        }
        return;
      }
      this.events.push(message);
    });
  }

  command(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.socket.send(JSON.stringify({id, method, params}));
    return new Promise((resolveCommand, rejectCommand) => {
      this.pending.set(id, {resolve: resolveCommand, reject: rejectCommand});
    });
  }

  close() {
    this.socket.close();
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`CDP endpoint failed: ${response.status}`);
  }
  return response.json();
}

async function evaluate(connection, expression) {
  const result = await connection.command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.text ?? 'Runtime evaluation failed');
  }
  return result.result?.value;
}

async function waitFor(connection, expression, description, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(connection, expression)) {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for ${description}`);
}

async function queryNode(connection, selector) {
  const document = await connection.command('DOM.getDocument', {depth: -1});
  const result = await connection.command('DOM.querySelector', {
    nodeId: document.root.nodeId,
    selector,
  });
  if (result.nodeId === 0) {
    throw new Error(`missing DOM node: ${selector}`);
  }
  return result.nodeId;
}

async function clickNode(connection, nodeId) {
  const box = await connection.command('DOM.getBoxModel', {nodeId});
  const quad = box.model.content;
  const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
  const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
  await connection.command('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', clickCount: 1});
  await connection.command('Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', clickCount: 1});
}

function collectRuntimeErrors(connection) {
  for (const event of connection.events) {
    if (event.method === 'Runtime.exceptionThrown') {
      errors.push({type: 'exception', detail: event.params?.exceptionDetails?.text ?? 'runtime exception'});
    }
    if (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error') {
      const text = event.params.entry.text ?? 'console error';
      if (text.includes('biliapi.net/socket.io')) continue;
      errors.push({type: 'console', detail: text});
    }
  }
}

const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
const target = targets.find((candidate) => candidate.type === 'page' && candidate.url === 'about:blank')
  ?? targets.find((candidate) => candidate.type === 'page' && !candidate.url.startsWith('edge://'));
if (target === undefined) {
  throw new Error(`no blank page target found for ${browserName}`);
}
const extensionTarget = targets.find((candidate) => candidate.type === 'service_worker' && candidate.url.endsWith('/service-worker.js'));
const extensionId = requestedExtensionId ?? (extensionTarget === undefined ? undefined : new URL(extensionTarget.url).hostname);
if (extensionId === undefined) {
  throw new Error(`${browserName} did not load the OpenJOC service worker`);
}
const connection = new CdpConnection(target.webSocketDebuggerUrl);
await connection.connect();
await connection.command('Runtime.enable');
await connection.command('Log.enable');
await connection.command('Page.enable');
await connection.command('DOM.enable');
await connection.command('Page.navigate', {url: `chrome-extension://${extensionId}/player.html?renderer=${requestedRenderer}`});
await waitFor(connection, "document.readyState === 'complete' && document.title.includes('OpenJOC')", 'extension player page');
const initial = await evaluate(connection, "({title:document.title, audioWorklet:typeof AudioWorkletNode, worker:typeof Worker, buttons:[...document.querySelectorAll('button')].map(button=>button.textContent)})");
const fileNode = await queryNode(connection, '#file-input');
await connection.command('DOM.setFileInputFiles', {nodeId: fileNode, files: [fixture]});
await waitFor(connection, "document.getElementById('state')?.textContent === 'ready'", 'file selection');
const fileName = await evaluate(connection, "document.getElementById('file-name')?.textContent");
let playNode = await queryNode(connection, '#play-button');
await clickNode(connection, playNode);
await waitFor(connection, "document.getElementById('state')?.textContent === 'playing' || document.getElementById('state')?.textContent === 'error'", 'playback startup', 20_000);
if (expectError) {
  await waitFor(connection, "document.getElementById('state')?.textContent === 'error'", 'malformed input diagnostic', 20_000);
  const malformedError = await evaluate(connection, "document.getElementById('error')?.textContent");
  const malformedDiagnostics = await evaluate(connection, "document.getElementById('diagnostics')?.textContent");
  collectRuntimeErrors(connection);
  connection.close();
  console.log(JSON.stringify({browser: browserName, extensionId, state: 'error', error: malformedError, diagnostics: malformedDiagnostics, errors}));
  let malformedStatus;
  try {
    malformedStatus = JSON.parse(malformedDiagnostics);
  } catch {
    malformedStatus = null;
  }
  if (errors.length > 0 || typeof malformedError !== 'string' || malformedError.length === 0 || malformedStatus === null || malformedStatus.decodeAccessUnits !== 0 || malformedStatus.outputSamples !== 0 || malformedStatus.sampleRate !== null || malformedStatus.outputChannels !== 2) {
    process.exit(1);
  }
  process.exit(0);
}
await waitFor(connection, "(() => { try { const value = JSON.parse(document.getElementById('diagnostics')?.textContent ?? '{}'); return value.decodeAccessUnits > 0; } catch { return false; } })()", 'initial AU decode before pause', 15_000);
const earlyPauseNode = await queryNode(connection, '#pause-button');
await clickNode(connection, earlyPauseNode);
await waitFor(connection, "document.getElementById('state')?.textContent === 'paused'", 'pause during decode');
const earlyResumeNode = await queryNode(connection, '#play-button');
await clickNode(connection, earlyResumeNode);
await waitFor(connection, "document.getElementById('state')?.textContent === 'playing'", 'resume during decode');
await waitFor(connection, `(() => { try { const value = JSON.parse(document.getElementById('diagnostics')?.textContent ?? '{}'); return value.decodeAccessUnits === 128 && value.outputFrames === 129 && value.outputSamples === ${expectedLifecycleSamples} && value.sampleRate === 48000 && value.outputChannels === 2 && value.audioSampleRate === 48000 && value.complexityIndex === 1 && value.totalMeanMs > 0 && value.totalP95Ms >= value.totalMeanMs && value.totalMaxMs >= value.totalP95Ms && value.realtimeFactor > 0; } catch { return false; } })()`, 'complete lifecycle decode and performance metrics', 30_000);
const state = await evaluate(connection, "document.getElementById('state')?.textContent");
const diagnosticText = await evaluate(connection, "document.getElementById('diagnostics')?.textContent");
const parsedDiagnostic = JSON.parse(diagnosticText);
if (parsedDiagnostic.renderer !== requestedRenderer || requestedRenderer === 'binaural' && (!(parsedDiagnostic.binauralP95Ms > 0) || parsedDiagnostic.latencySamples !== 577)) {
  throw new Error(`CDP renderer diagnostics mismatch: ${JSON.stringify({expected: requestedRenderer, actual: parsedDiagnostic})}`);
}
const errorText = await evaluate(connection, "document.getElementById('error')?.textContent");
const pauseNode = await queryNode(connection, '#pause-button');
await clickNode(connection, pauseNode);
await waitFor(connection, "document.getElementById('state')?.textContent === 'paused'", 'pause');
playNode = await queryNode(connection, '#play-button');
await clickNode(connection, playNode);
await waitFor(connection, "document.getElementById('state')?.textContent === 'playing'", 'resume');
await waitFor(connection, "(() => { try { const value = JSON.parse(document.getElementById('diagnostics')?.textContent ?? '{}'); return value.queueAudioMs <= 5 && value.underruns === 0; } catch { return false; } })()", 'AudioWorklet queue consumption to EOS', 15_000);
const consumedDiagnostics = await evaluate(connection, "document.getElementById('diagnostics')?.textContent");
const stopNode = await queryNode(connection, '#stop-button');
await clickNode(connection, stopNode);
await waitFor(connection, "document.getElementById('state')?.textContent === 'stopped' && document.getElementById('diagnostics')?.textContent === 'waiting for decoder'", 'stop/reset');
const resetState = await evaluate(connection, "document.getElementById('state')?.textContent");
const reopenFileNode = await queryNode(connection, '#file-input');
await connection.command('DOM.setFileInputFiles', {nodeId: reopenFileNode, files: [reopenFixture]});
await waitFor(connection, "document.getElementById('state')?.textContent === 'ready'", 'reopen file selection');
const reopenPlayNode = await queryNode(connection, '#play-button');
await clickNode(connection, reopenPlayNode);
await waitFor(connection, "document.getElementById('state')?.textContent === 'playing' || document.getElementById('state')?.textContent === 'error'", 'reopen playback startup', 20_000);
await waitFor(connection, `(() => { try { const value = JSON.parse(document.getElementById('diagnostics')?.textContent ?? '{}'); return value.decodeAccessUnits === 8 && value.outputFrames === 2 && value.outputSamples === ${expectedReopenSamples} && value.sampleRate === 48000 && value.outputChannels === 2 && value.totalMeanMs > 0; } catch { return false; } })()`, 'reopen fixture decode', 20_000);
const reopenDiagnostics = await evaluate(connection, "document.getElementById('diagnostics')?.textContent");
const finalStopNode = await queryNode(connection, '#stop-button');
await clickNode(connection, finalStopNode);
await waitFor(connection, "document.getElementById('state')?.textContent === 'stopped' && document.getElementById('diagnostics')?.textContent === 'waiting for decoder'", 'final reset');
collectRuntimeErrors(connection);
connection.close();

console.log(JSON.stringify({
  browser: browserName,
  extensionId,
  page: initial,
  fileName,
  state,
  error: errorText,
  diagnostics: diagnosticText,
  consumedDiagnostics,
  reopenDiagnostics,
  resetState,
  errors,
}));
if (state === 'error' || errors.length > 0) {
  process.exit(1);
}
