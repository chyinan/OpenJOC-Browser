// pattern: Imperative Shell

import {readFileSync} from 'node:fs';
import {WasmDecoderClient} from '../extension/wasm-bindings.js';

const loops = Number(process.argv[2] ?? 147);
const fixture = readFileSync('fixtures/joc.lifecycle.ec3');
const wasmBytes = readFileSync('extension/wasm/openjoc_wasm.wasm');

if (!Number.isSafeInteger(loops) || loops < 1) throw new Error('loops must be a positive safe integer');

const {instance} = await WebAssembly.instantiate(wasmBytes, {
  env: {openjoc_wasm_clock_now_ms: () => performance.now()},
});
const decoder = new WasmDecoderClient(instance, {renderer: 'binaural'});
let peakWasmBytes = 0;
let peakJsHeapBytes = 0;
let mediaSamples = 0;
let outputSamples = 0;
let outputFrames = 0;
let maxUnderruns = 0;

function collect() {
  while (decoder.receivePcm() !== null) {
    outputFrames += 1;
  }
}

for (let loop = 0; loop < loops; loop += 1) {
  decoder.reset();
  for (let offset = 0; offset < fixture.length; offset += 4_097) {
    decoder.pushBytes(fixture.subarray(offset, Math.min(fixture.length, offset + 4_097)));
    collect();
  }
  while (decoder.flush() !== 3) collect();
  collect();
  const status = decoder.status();
  if (status.renderer !== 'binaural' || status.virtualLayout !== '7.1.4' || status.hrtf !== 'Built-in SADIE II D1' || status.outputChannels !== 2 || status.sampleRate !== 48_000) {
    throw new Error(`renderer contract changed during loop ${loop}: ${JSON.stringify(status)}`);
  }
  peakWasmBytes = Math.max(peakWasmBytes, status.wasmMemoryBytes, status.wasmMemoryPeakBytes);
  peakJsHeapBytes = Math.max(peakJsHeapBytes, process.memoryUsage().heapUsed);
  mediaSamples += status.outputSamples;
  outputSamples += status.outputSamples;
  maxUnderruns = Math.max(maxUnderruns, status.underrunCount);
  if (loop % 10 === 0 || loop + 1 === loops) {
    console.log(`loop=${loop + 1}/${loops} media_seconds=${(mediaSamples / 48_000).toFixed(1)} wasm_bytes=${status.wasmMemoryBytes} wasm_peak=${status.wasmMemoryPeakBytes} js_heap=${process.memoryUsage().heapUsed} output_frames=${outputFrames} underruns=${status.underrunCount}`);
  }
}

decoder.destroy();
console.log(JSON.stringify({
  loops,
  mediaSeconds: mediaSamples / 48_000,
  outputSamples,
  outputFrames,
  peakWasmBytes,
  peakJsHeapBytes,
  maxUnderruns,
}));
