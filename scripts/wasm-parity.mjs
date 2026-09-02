// pattern: Imperative Shell

import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const openjocRoot = process.env.OPENJOC_ROOT === undefined
  ? resolve(browserRoot, '..', 'OpenJOC')
  : resolve(process.env.OPENJOC_ROOT);
const fixture = resolve(process.argv[2] ?? join(browserRoot, 'fixtures', 'joc.lifecycle.ec3'));
const artifactRoot = join(browserRoot, 'artifacts');
const nativeOutput = join(artifactRoot, 'native.f32le');
const nativeMetadataOutput = join(artifactRoot, 'native.meta');
const wasmOutput = join(artifactRoot, 'wasm.f32le');
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';

function runNativeReference() {
  const result = spawnSync(cargo, [
    'run',
    '--manifest-path', join(openjocRoot, 'Cargo.toml'),
    '-p', 'openjoc-wasm',
    '--example', 'dump-native-pcm',
    '--release',
    '--', fixture, nativeOutput, nativeMetadataOutput,
  ], {cwd: openjocRoot, stdio: 'inherit'});
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function decodeWasm() {
  const wasmPath = join(browserRoot, 'extension', 'wasm', 'openjoc_wasm.wasm');
  const input = readFileSync(fixture);
  const wasmBytes = readFileSync(wasmPath);
  return WebAssembly.instantiate(wasmBytes, {
    env: {
      openjoc_wasm_clock_now_ms: () => performance.now(),
    },
  }).then(({instance}) => {
    const exports_ = instance.exports;
    const decoder = exports_.openjoc_wasm_decoder_create();
    const initialMemoryBytes = exports_.memory.buffer.byteLength;
    let peakMemoryBytes = initialMemoryBytes;
    const recordMemory = () => {
      peakMemoryBytes = Math.max(peakMemoryBytes, exports_.memory.buffer.byteLength);
    };
    const chunks = [];
    const takePcm = () => {
      while (exports_.openjoc_wasm_decoder_receive_pcm(decoder) === 1) {
        const length = exports_.openjoc_wasm_decoder_pcm_len(decoder);
        const pointer = exports_.openjoc_wasm_decoder_pcm_ptr(decoder);
        const byteLength = length * Float32Array.BYTES_PER_ELEMENT;
        const bytes = new Uint8Array(exports_.memory.buffer, pointer, byteLength);
        chunks.push(Buffer.from(bytes));
        exports_.openjoc_wasm_decoder_consume_pcm(decoder);
      }
    };
    const push = (bytes) => {
      const pointer = exports_.openjoc_wasm_alloc(bytes.length);
      if (pointer === 0) {
        throw new Error('WASM input allocation failed');
      }
      new Uint8Array(exports_.memory.buffer, pointer, bytes.length).set(bytes);
      const status = exports_.openjoc_wasm_decoder_push_bytes(decoder, pointer, bytes.length);
      exports_.openjoc_wasm_dealloc(pointer, bytes.length);
      recordMemory();
      if (status < 0) {
        throw new Error('WASM push failed');
      }
      takePcm();
      recordMemory();
    };
    for (let offset = 0; offset < input.length; offset += 4097) {
      push(input.subarray(offset, Math.min(input.length, offset + 4097)));
    }
    while (true) {
      const status = exports_.openjoc_wasm_decoder_flush(decoder);
      if (status < 0) {
        throw new Error('WASM flush failed');
      }
      takePcm();
      if (status === 3) {
        break;
      }
    }
    const pcm = Buffer.concat(chunks);
    const result = {
      pcm,
      sampleRate: exports_.openjoc_wasm_decoder_sample_rate(decoder),
      channels: exports_.openjoc_wasm_decoder_channel_count(decoder),
      accessUnits: exports_.openjoc_wasm_decoder_decoded_access_units(decoder),
      frames: exports_.openjoc_wasm_decoder_output_frames(decoder),
      samples: Number(exports_.openjoc_wasm_decoder_output_samples(decoder)),
      memoryBytes: exports_.memory.buffer.byteLength,
      memoryPeakBytes: peakMemoryBytes,
      memoryGrowthBytes: peakMemoryBytes - initialMemoryBytes,
      profile: readText(exports_, decoder, 'openjoc_wasm_decoder_profile_ptr', 'openjoc_wasm_decoder_profile_len'),
      downmixIndex: optionalUint(exports_.openjoc_wasm_decoder_downmix_index(decoder)),
      objectCount: optionalUint(exports_.openjoc_wasm_decoder_object_count(decoder)),
      complexityIndex: optionalUint(exports_.openjoc_wasm_decoder_complexity_index(decoder)),
      decodeMeanMs: exports_.openjoc_wasm_decoder_decode_mean_ms(decoder),
      decodeP95Ms: exports_.openjoc_wasm_decoder_decode_p95_ms(decoder),
      decodeMaxMs: exports_.openjoc_wasm_decoder_decode_max_ms(decoder),
      renderMeanMs: exports_.openjoc_wasm_decoder_render_mean_ms(decoder),
      renderP95Ms: exports_.openjoc_wasm_decoder_render_p95_ms(decoder),
      renderMaxMs: exports_.openjoc_wasm_decoder_render_max_ms(decoder),
      totalMeanMs: exports_.openjoc_wasm_decoder_total_mean_ms(decoder),
      totalP95Ms: exports_.openjoc_wasm_decoder_total_p95_ms(decoder),
      totalMaxMs: exports_.openjoc_wasm_decoder_total_max_ms(decoder),
      realtimeFactor: exports_.openjoc_wasm_decoder_realtime_factor(decoder),
    };
    exports_.openjoc_wasm_decoder_destroy(decoder);
    return result;
  });
}

function readText(exports_, decoder, pointerName, lengthName) {
  const pointer = exports_[pointerName](decoder);
  const length = exports_[lengthName](decoder);
  if (pointer === 0 || length === 0) {
    return null;
  }
  return new TextDecoder().decode(new Uint8Array(exports_.memory.buffer, pointer, length));
}

function optionalUint(value) {
  return value === -1 || value === 0xffff_ffff ? null : value;
}

function parseMetadata(text) {
  return Object.fromEntries(text.trim().split(/\r?\n/).map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

function assertMetadata(nativeMetadata, wasm) {
  const expected = {
    sample_rate: '48000',
    channels: '2',
    frame_count: '129',
    samples: '196640',
    access_units: '128',
    profile: 'etsi-strict',
    downmix_index: '0',
    object_count: '1',
    complexity_index: '1',
  };
  for (const [key, value] of Object.entries(expected)) {
    if (nativeMetadata[key] !== value) {
      throw new Error(`native metadata mismatch: ${key}=${nativeMetadata[key]}`);
    }
  }
  const actual = {
    sample_rate: String(wasm.sampleRate),
    channels: String(wasm.channels),
    frame_count: String(wasm.frames),
    samples: String(wasm.samples),
    access_units: String(wasm.accessUnits),
    profile: wasm.profile,
    downmix_index: String(wasm.downmixIndex),
    object_count: String(wasm.objectCount),
    complexity_index: String(wasm.complexityIndex),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw new Error(`WASM metadata mismatch: ${key}=${actual[key]}`);
    }
  }
  const nativeDurationMs = Number(nativeMetadata.duration_ms);
  const wasmDurationMs = wasm.samples * 1000 / wasm.sampleRate;
  if (!Number.isFinite(nativeDurationMs) || Math.abs(nativeDurationMs - wasmDurationMs) > 0.000001) {
    throw new Error(`duration mismatch: native=${nativeDurationMs} wasm=${wasmDurationMs}`);
  }
  for (const value of [
    wasm.decodeMeanMs,
    wasm.decodeP95Ms,
    wasm.decodeMaxMs,
    wasm.renderMeanMs,
    wasm.renderP95Ms,
    wasm.renderMaxMs,
    wasm.totalMeanMs,
    wasm.totalP95Ms,
    wasm.totalMaxMs,
    wasm.realtimeFactor,
  ]) {
    if (!(value > 0) || !Number.isFinite(value)) {
      throw new Error(`WASM performance metric is invalid: ${value}`);
    }
  }
  if (!Number.isSafeInteger(wasm.memoryBytes) || !Number.isSafeInteger(wasm.memoryPeakBytes) || !Number.isSafeInteger(wasm.memoryGrowthBytes) || wasm.memoryGrowthBytes < 0 || wasm.memoryPeakBytes > 128 * 1024 * 1024) {
    throw new Error(`WASM memory metrics are invalid: ${JSON.stringify({bytes: wasm.memoryBytes, peak: wasm.memoryPeakBytes, growth: wasm.memoryGrowthBytes})}`);
  }
}

runNativeReference();
const native = readFileSync(nativeOutput);
const nativeMetadata = parseMetadata(readFileSync(nativeMetadataOutput, 'utf8'));
const wasm = await decodeWasm();
writeFileSync(wasmOutput, wasm.pcm);
if (native.length !== wasm.pcm.length) {
  throw new Error(`PCM byte length mismatch: native=${native.length} wasm=${wasm.pcm.length}`);
}
assertMetadata(nativeMetadata, wasm);
if (!native.equals(wasm.pcm)) {
  const limit = Math.min(native.length, wasm.pcm.length);
  let offset = 0;
  while (offset < limit && native[offset] === wasm.pcm[offset]) {
    offset += 1;
  }
  throw new Error(`NATIVE_VS_WASM_PCM mismatch at byte ${offset}`);
}
console.log(`NATIVE_VS_WASM_PCM=BIT_IDENTICAL bytes=${wasm.pcm.length}`);
console.log(`WASM sample_rate=${wasm.sampleRate} channels=${wasm.channels} access_units=${wasm.accessUnits} samples=${wasm.samples}`);
console.log(`WASM timing decode_ms=${wasm.decodeMeanMs.toFixed(3)}/${wasm.decodeP95Ms.toFixed(3)}/${wasm.decodeMaxMs.toFixed(3)} render_ms=${wasm.renderMeanMs.toFixed(3)}/${wasm.renderP95Ms.toFixed(3)}/${wasm.renderMaxMs.toFixed(3)} total_ms=${wasm.totalMeanMs.toFixed(3)}/${wasm.totalP95Ms.toFixed(3)}/${wasm.totalMaxMs.toFixed(3)} realtime_factor=${wasm.realtimeFactor.toFixed(3)}`);
console.log(`WASM memory bytes=${wasm.memoryBytes} peak=${wasm.memoryPeakBytes} growth=${wasm.memoryGrowthBytes}`);
