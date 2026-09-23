// pattern: Imperative Shell

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {WasmDecoderClient} from '../extension/wasm-bindings.js';
import {HRTF_ASSET_VERSION, hrtfAssetMetadata} from '../extension/hrtf-presets.js';

const assetsRoot = join('extension', 'wasm', 'hrtf');
const wasmBytes = readFileSync('extension/wasm/openjoc_wasm.wasm');
const assetManifest = JSON.parse(readFileSync(join(assetsRoot, 'manifest.json'), 'utf8'));
const fixture = readFileSync('fixtures/joc.lifecycle.ec3');
const requestedPresets = process.argv.slice(2).filter((value) => !value.startsWith('--'));
const presets = requestedPresets.length === 0
  ? ['sadie-ii-d1-ku100', 'sadie-ii-d2-kemar']
  : requestedPresets;
const switchCycle = process.argv.includes('--switch-cycle');
const runOrder = switchCycle ? [...presets, ...presets, presets[0]] : presets;
const wasmImports = {env: {openjoc_wasm_clock_now_ms: () => performance.now()}};
let activeInstance = null;
let activeDecoder = null;
const firstSelectionMemoryByPreset = new Map();
let peakOverlappingWasmLinearBytes = 0;

for (const [runIndex, preset] of runOrder.entries()) {
  if (assetManifest.assetVersion !== HRTF_ASSET_VERSION || !assetManifest.bundledPresets.includes(preset)) {
    throw new Error(`benchmark requires a package containing ${preset} at ${HRTF_ASSET_VERSION}; run npm run build first`);
  }
  const assetStarted = performance.now();
  let asset = readFileSync(join(assetsRoot, `${preset}.ojhrtf`));
  const assetBytes = asset.byteLength;
  const assetLoadMs = performance.now() - assetStarted;
  const metadata = assetManifest.assets[preset];
  const tapSampleBytes = asset.byteLength - 56 - 40 - metadata.directionCount * 36;
  if (tapSampleBytes < 0 || tapSampleBytes % 4 !== 0) throw new Error(`malformed packed asset size: ${preset}`);
  const f32TapBytes = tapSampleBytes;
  const directionMetadataBytes = metadata.directionCount * 40;
  const integrityStarted = performance.now();
  const digest = await crypto.subtle.digest('SHA-256', asset);
  const assetSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const assetIntegrityMs = performance.now() - integrityStarted;
  if (assetSha256 !== hrtfAssetMetadata(preset).sha256) throw new Error(`HRTF asset hash mismatch: ${preset}`);
  let retiringDecoder = switchCycle ? activeDecoder : null;
  let retiringInstance = switchCycle ? activeInstance : null;
  const retiringWasmLinearBytes = retiringInstance?.exports.memory.buffer.byteLength ?? 0;
  const rssBeforeSelection = process.memoryUsage().rss;
  const instantiateStarted = performance.now();
  let {instance} = await WebAssembly.instantiate(wasmBytes, wasmImports);
  const wasmInstantiateMs = performance.now() - instantiateStarted;
  let memory = instance.exports.memory;
  const memoryBeforeSelection = memory.buffer.byteLength;
  const initializationStarted = performance.now();
  let decoder = new WasmDecoderClient(instance, {
    renderer: 'binaural',
    hrtf: preset,
    hrtfAsset: asset,
  });
  const initializationMs = performance.now() - initializationStarted;
  const memoryAfterSelection = memory.buffer.byteLength;
  const overlappingWasmLinearBytes = memoryAfterSelection + retiringWasmLinearBytes;
  peakOverlappingWasmLinearBytes = Math.max(peakOverlappingWasmLinearBytes, overlappingWasmLinearBytes);
  if (switchCycle) {
    const expectedMemoryBytes = firstSelectionMemoryByPreset.get(preset);
    if (expectedMemoryBytes !== undefined && memoryAfterSelection !== expectedMemoryBytes) {
      throw new Error(`WASM linear-memory capacity changed across fresh ${preset} instances: ${memoryAfterSelection} !== ${expectedMemoryBytes}`);
    }
    firstSelectionMemoryByPreset.set(preset, expectedMemoryBytes ?? memoryAfterSelection);
  }
  const rssWithAssetStaging = process.memoryUsage().rss;
  // loadOpenJocWasm returns the decoder after copying the asset into WASM;
  // the returned decoder does not retain this JS staging buffer.
  asset = null;
  const rssAfterAssetDereference = process.memoryUsage().rss;
  if (switchCycle) {
    activeInstance = instance;
    activeDecoder = decoder;
    retiringDecoder?.destroy();
    retiringDecoder = null;
    retiringInstance = null;
  }
  const firstRenderStarted = performance.now();
  let firstOutputMs = null;
  const collect = () => {
    while (decoder.receivePcm() !== null) {
      if (firstOutputMs === null) firstOutputMs = performance.now() - firstRenderStarted;
    }
  };
  for (let offset = 0; offset < fixture.length; offset += 4_097) {
    decoder.pushBytes(fixture.subarray(offset, Math.min(fixture.length, offset + 4_097)));
    collect();
  }
  while (decoder.flush() !== 3) collect();
  collect();
  const status = decoder.status();
  const memoryAfterRender = memory.buffer.byteLength;
  const rssAfterRender = process.memoryUsage().rss;
  if (!switchCycle) decoder.destroy();
  decoder = null;
  const memoryAfterTransition = memory.buffer.byteLength;
  memory = null;
  if (!switchCycle) instance = null;
  await new Promise((resolve) => setImmediate(resolve));
  if (typeof global.gc === 'function') global.gc();
  const rssAfterTransition = process.memoryUsage().rss;
  console.log(JSON.stringify({
    preset,
    runIndex,
    switchCycle,
    wasmInstanceRecreated: switchCycle,
    packageKind: assetManifest.packageKind,
    assetBytes,
    assetLoadMs,
    assetIntegrityMs,
    wasmInstantiateMs,
    assetArrayBufferBytes: assetBytes,
    wasmInputCopyBytes: assetBytes,
    f32TapBytes,
    directionMetadataBytes,
    f32ResidentBankBytesDuringInit: f32TapBytes + directionMetadataBytes,
    fullF64BankBytesInProduction: 0,
    initializationMs,
    firstOutputMs,
    wasmBytes: wasmBytes.byteLength,
    memoryBeforeSelection,
    memoryAfterSelection,
    wasmLinearGrowthOnSelectionBytes: memoryAfterSelection - memoryBeforeSelection,
    memoryAfterRender,
    memoryAfterTransition,
    retiringWasmLinearBytes,
    overlappingWasmLinearBytes,
    peakOverlappingWasmLinearBytes,
    wasmReportedPeak: status.wasmMemoryPeakBytes,
    binauralMeanMs: status.binauralMeanMs,
    outputFrames: status.outputFrames,
    rssBeforeSelection,
    rssWithAssetStaging,
    rssAfterAssetDereference,
    rssAfterRender,
    rssAfterTransition,
  }));
}

if (switchCycle && activeDecoder !== null && activeInstance !== null) {
  const finalInstanceMemoryBytes = activeInstance.exports.memory.buffer.byteLength;
  activeDecoder.destroy();
  activeDecoder = null;
  activeInstance = null;
  await new Promise((resolve) => setImmediate(resolve));
  if (typeof global.gc === 'function') global.gc();
  console.log(JSON.stringify({
    switchCycleComplete: true,
    instancesCreated: runOrder.length,
    peakOverlappingWasmLinearBytes,
    finalInstanceMemoryBytes,
    rssAfterFinalInstanceRelease: process.memoryUsage().rss,
  }));
}
