// pattern: Imperative Shell

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm';
import ts from 'typescript';

const sourceRoot = new URL('../../src/', import.meta.url);

/** Execute real extension modules; replace only browser/network boundaries in tests. */
export function createSourceRuntime(globals = {}, replacements = {}) {
  const context = createContext({
    console, URL, Response, Headers, AbortController, WebAssembly,
    ArrayBuffer, Uint8Array, Float32Array, TextDecoder, performance, crypto, atob, btoa,
    ...globals,
  });
  const modules = new Map();

  function getModule(url) {
    const key = url.href;
    if (modules.has(key)) return modules.get(key);
    const replacement = replacements[fileURLToPath(url).split(/[\\/]/).at(-1)];
    let module;
    if (replacement) {
      module = new SyntheticModule(Object.keys(replacement), function () {
        for (const [name, value] of Object.entries(replacement)) this.setExport(name, value);
      }, {context, identifier: key});
    } else {
      const path = fileURLToPath(url).replace(/\.js$/, '.ts');
      const source = ts.transpileModule(readFileSync(path, 'utf8'), {
        compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022},
        fileName: path,
      }).outputText;
      module = new SourceTextModule(source, {
        context, identifier: key,
        initializeImportMeta(meta) { meta.url = key; },
      });
    }
    modules.set(key, module);
    return module;
  }

  return {
    async load(name) {
      const module = getModule(new URL(name, sourceRoot));
      if (module.status === 'unlinked') await module.link((specifier, parent) => getModule(new URL(specifier, parent.identifier)));
      if (module.status === 'linked') await module.evaluate();
      return module.namespace;
    },
  };
}

export async function waitFor(condition, description, timeoutMs = 12_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const result = condition();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${description}`);
}

export async function createPlaybackRuntime(options = {}) {
  const messages = [];
  const workers = [];
  const nodes = [];
  const timers = new Set();
  const listeners = [];
  const pcmMessages = [];
  const workletStats = [];
  let renderedQuantumCount = 0;
  let processorClass;
  let newProcessorPort;
  let idleOffsetMs = 0;
  let areWindowIntervalsSuspended = options.windowIntervalsSuspended === true;
  const accessUnitsPerSegment = options.accessUnitsPerSegment ?? 64;
  const fixture = readFileSync(new URL('../../fixtures/joc.lifecycle.ec3', import.meta.url));
  const wasm = readFileSync(new URL('../../extension/wasm/openjoc_wasm.wasm', import.meta.url));
  const references = Array.from({length: options.segments ?? 2}, (_, index) => ({ptsSamples: index * accessUnitsPerSegment * 1536, durationSamples: accessUnitsPerSegment * 1536}));

  const scheduler = {
    setTimeout(fn, ms) {
      const id = setTimeout(() => {timers.delete(id); fn();}, ms);
      timers.add(id);
      return id;
    },
    clearTimeout(id) {clearTimeout(id); timers.delete(id);},
    setInterval(fn, ms) {const id = setInterval(fn, ms); timers.add(id); return id;},
    clearInterval(id) {clearInterval(id); timers.delete(id);},
  };
  const windowScheduler = {
    ...scheduler,
    setInterval(fn, ms) {return scheduler.setInterval(() => {if (!areWindowIntervalsSuspended) fn();}, ms);},
  };

  const worklet = createSourceRuntime({
    sampleRate: 48_000,
    AudioWorkletProcessor: class { constructor() {this.port = newProcessorPort;} },
    registerProcessor(_name, constructor) {processorClass = constructor;},
  });
  await worklet.load('pcm-processor.js');

  class TestAudioWorkletNode {
    constructor(context) {
      this.context = context;
      this.connected = false;
      this.parameters = new Map((processorClass.parameterDescriptors ?? []).map(descriptor => [descriptor.name, {
        value: descriptor.defaultValue,
        events: [],
        cancelAndHoldAtTime(time) {this.events.push({type: 'hold', time}); return this;},
        setValueAtTime(value, time) {this.value = value; this.events.push({type: 'value', value, time}); return this;},
        setTargetAtTime(value, time, constant) {this.value = value; this.events.push({type: 'target', value, time, constant}); return this;},
      }]));
      this.port = {
        onmessage: null,
        postMessage: message => queueMicrotask(() => this.processor.port.onmessage?.({data: message})),
      };
      newProcessorPort = {
        onmessage: null,
        postMessage: data => {
          if (data.type === 'stats') workletStats.push(data);
          queueMicrotask(() => this.port.onmessage?.({data}));
        },
        dispatch(data) {
          if (data.type === 'stats') workletStats.push(data);
          thisNodePort?.onmessage?.({data});
        },
      };
      const thisNodePort = this.port;
      this.processor = new processorClass();
      nodes.push(this);
    }
    connect() {this.connected = true;}
    disconnect() {this.connected = false;}
  }

  class TestAudioContext {
    sampleRate = 48_000;
    state = 'suspended';
    destination = {};
    baseLatency = 0;
    outputLatency = 0;
    audioWorklet = {addModule: async () => {}};
    get currentTime() {return performance.now() / 1000;}
    getOutputTimestamp() {return {contextTime: performance.now() / 1000, performanceTime: performance.now()};}
    createGain() {return {gain: {value: 0}, connect() {return this;}};}
    createConstantSource() {return {offset: {value: 0}, connect(target) {return target;}, start() {}, stop() {}, disconnect() {}};}
    async resume() {this.state = 'running';}
    async suspend() {this.state = 'suspended';}
    async close() {this.state = 'closed';}
  }

  class TestWorker {
    onmessage = null;
    onerror = null;
    terminated = false;
    constructor() {
      workers.push(this);
      this.scope = {
        ...scheduler,
        postMessage: message => {
          if (message.type === 'pcm') pcmMessages.push(message);
          queueMicrotask(() => {if (!this.terminated) this.onmessage?.({data: message});});
        },
        onmessage: null,
      };
      const runtime = createSourceRuntime({
        self: this.scope,
        fetch: async () => new Response(wasm),
      });
      this.ready = runtime.load('decoder-worker.js');
    }
    postMessage(message) {
      void this.ready.then(() => {if (!this.terminated) this.scope.onmessage?.({data: message});});
    }
    terminate() {this.terminated = true;}
  }

  const runtime = createSourceRuntime({
    ...scheduler, window: windowScheduler, Worker: TestWorker,
    performance: {now: () => performance.now() + idleOffsetMs},
    AudioContext: TestAudioContext, AudioWorkletNode: TestAudioWorkletNode,
    chrome: {runtime: {
      onMessage: {addListener(listener) {listeners.push(listener);}},
      async sendMessage(message) {
        messages.push(message);
        options.onStatus?.(message);
        if (options.autoReady !== false && message.phase === 'ready') {
          queueMicrotask(() => dispatch({target: 'offscreen', type: 'native-muted', tabId: message.tabId, generation: message.generation}));
        }
      },
    }},
  }, {
    'cmaf-fetcher.js': {
      async fetchCmafIndex(fetchOptions) {
        await options.onFetchIndex?.(fetchOptions);
        return {url: fetchOptions.url, pageUrl: fetchOptions.pageUrl, init: {trackId: 1}, index: {timescale: 48_000, earliestPresentationTime: 0, references}};
      },
      async fetchCmafSegment(_session, reference) {
        const first = reference.ptsSamples / 1536;
        return Array.from({length: accessUnitsPerSegment}, (_, index) => ({
          ptsSamples: (first + index) * 1536,
          bytes: new Uint8Array(fixture.subarray(((first + index) % 128) * 4096, (((first + index) % 128) + 1) * 4096)),
        }));
      },
    },
  });

  function dispatch(message) {for (const listener of listeners) listener(message);}
  await runtime.load('offscreen.js');
  scheduler.setInterval(() => {
    for (const node of nodes) {
      if (node.connected && node.context.state === 'running') node.processor.process([], [[new Float32Array(128), new Float32Array(128)]], Object.fromEntries([...node.parameters].map(([name, parameter]) => [name, new Float32Array([parameter.value])])));
    }
  }, 3);

  scheduler.setInterval(() => {
    renderedQuantumCount += nodes.filter(node => node.connected && node.context.state === 'running').length;
  }, 3);

  return {
    messages, pcmMessages, workletStats, dispatch,
    emitWorkletStats(stats) {newProcessorPort?.dispatch(stats);},
    get renderedQuantumCount() {return renderedQuantumCount;},
    get outputGain() {return nodes.at(-1)?.parameters.get('outputGain')?.value;},
    get gainAutomation() {return nodes.at(-1)?.parameters.get('outputGain')?.events ?? [];},
    elapseIdle(ms) {idleOffsetMs += ms;},
    suspendWindowIntervals() {areWindowIntervalsSuspended = true;},
    resumeWindowIntervals() {areWindowIntervalsSuspended = false;},
    start(generation, requestId, media = 'A', tabId = 1, playbackState = {}) {
      const request = {
        target: 'offscreen', type: 'start', requestId, tabId, generation,
        pageUrl: `https://www.bilibili.com/video/BV${media}/`,
        mediaKey: {bvid: `BV${media}`, aid: media, cid: media},
        candidate: {id: 'dolby', source: 'dolby', codecs: 'ec-3', mimeType: 'audio/mp4', bandwidth: 1000000, baseUrl: 'https://media.bilivideo.com/audio.m4s', backupUrls: []},
        videoTimeSamples: 0, paused: playbackState.paused ?? false, buffering: playbackState.buffering ?? false,
        dialnorm: 'unity', renderer: 'stereo',
      };
      dispatch(request);
      return request;
    },
    async active(requestId) {
      const result = await waitFor(() => messages.find(message => message.requestId === requestId && ((message.phase === 'active' && message.metrics.currentAudioMediaTime !== null) || message.phase === 'error')), `${requestId} to produce accepted PCM`);
      if (result.phase === 'error') throw new Error(`${requestId}: ${result.reason}; PCM generations=${pcmMessages.slice(-3).map(m => m.generation)}; worklet generation=${workletStats.at(-1)?.generation}`);
      return result;
    },
    close() {
      for (const worker of workers) worker.terminate();
      for (const timer of timers) {clearTimeout(timer); clearInterval(timer);}
      timers.clear();
    },
  };
}
