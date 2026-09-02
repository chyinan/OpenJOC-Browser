// pattern: Imperative Shell

import {readFileSync} from 'node:fs';
import {parseCmafFragment, parseCmafInitSegment} from '../extension/cmaf-transport.js';
import {WasmDecoderClient} from '../extension/wasm-bindings.js';

const SAMPLE_BYTES = 4_096;
const SAMPLE_DURATION = 1_536;
const fixture = readFileSync('fixtures/joc.lifecycle.ec3');
const wasmBytes = readFileSync('extension/wasm/openjoc_wasm.wasm');

function u32(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function box(type, payload) {
  return new Uint8Array([...u32(payload.length + 8), ...Buffer.from(type, 'ascii'), ...payload]);
}

function fullBox(type, versionFlags, payload) {
  return box(type, [...u32(versionFlags), ...payload]);
}

function makeInit() {
  const mdhd = fullBox('mdhd', 0, [...u32(0), ...u32(0), ...u32(48_000), ...u32(0), 0, 0, 0, 0]);
  const hdlr = fullBox('hdlr', 0, [0, 0, 0, 0, ...Buffer.from('soun'), ...Array(12).fill(0)]);
  const dec3 = box('dec3', Array(8).fill(0));
  const sampleEntry = box('ec-3', [...Array(28).fill(0), ...dec3]);
  const stsd = fullBox('stsd', 0, [...u32(1), ...sampleEntry]);
  const stbl = box('stbl', stsd);
  const minf = box('minf', stbl);
  const mdia = box('mdia', new Uint8Array([...mdhd, ...hdlr, ...minf]));
  const tkhd = fullBox('tkhd', 0, [...u32(0), ...u32(0), ...u32(1)]);
  const trak = box('trak', new Uint8Array([...tkhd, ...mdia]));
  return new Uint8Array([...box('ftyp', Array(16).fill(0)), ...box('moov', trak)]);
}

function makeFragment(sample, ptsSamples) {
  const tfhd = fullBox('tfhd', 0, u32(1));
  const tfdt = fullBox('tfdt', 0, u32(ptsSamples));
  const initialTrun = fullBox('trun', 0x0000_0301, [...u32(1), ...u32(0), ...u32(SAMPLE_DURATION), ...u32(sample.length)]);
  const initialTraf = box('traf', new Uint8Array([...tfhd, ...tfdt, ...initialTrun]));
  const initialMoof = box('moof', new Uint8Array([...fullBox('mfhd', 0, u32(1)), ...initialTraf]));
  const dataOffset = initialMoof.length + 8;
  const trun = fullBox('trun', 0x0000_0301, [...u32(1), ...u32(dataOffset), ...u32(SAMPLE_DURATION), ...u32(sample.length)]);
  const traf = box('traf', new Uint8Array([...tfhd, ...tfdt, ...trun]));
  const moof = box('moof', new Uint8Array([...fullBox('mfhd', 0, u32(1)), ...traf]));
  return new Uint8Array([...moof, ...box('mdat', sample)]);
}

async function createDecoder() {
  const {instance} = await WebAssembly.instantiate(wasmBytes, {env: {openjoc_wasm_clock_now_ms: () => performance.now()}});
  return new WasmDecoderClient(instance);
}

function collectPcm(decoder, output) {
  while (true) {
    const block = decoder.receivePcm();
    if (block === null) return;
    output.push(Buffer.from(block.samples.buffer, block.samples.byteOffset, block.samples.byteLength));
  }
}

async function decodeRaw() {
  const decoder = await createDecoder();
  const output = [];
  for (let offset = 0; offset < fixture.length; offset += 4_097) {
    decoder.pushBytes(fixture.subarray(offset, Math.min(offset + 4_097, fixture.length)));
    collectPcm(decoder, output);
  }
  while (decoder.flush() !== 3) collectPcm(decoder, output);
  collectPcm(decoder, output);
  const status = decoder.status();
  decoder.destroy();
  return {pcm: Buffer.concat(output), status};
}

async function decodeCmaf() {
  const decoder = await createDecoder();
  const init = parseCmafInitSegment(makeInit());
  const output = [];
  const accessUnits = fixture.length / SAMPLE_BYTES;
  for (let index = 0; index < accessUnits; index += 1) {
    const raw = fixture.subarray(index * SAMPLE_BYTES, (index + 1) * SAMPLE_BYTES);
    const fragment = parseCmafFragment(makeFragment(raw, index * SAMPLE_DURATION), init.trackId);
    for (const sample of fragment) {
      decoder.pushPacket(sample.bytes, {ptsSamples: sample.ptsSamples, discontinuity: index === 0, preroll: index === 0});
      collectPcm(decoder, output);
    }
  }
  while (decoder.flush() !== 3) collectPcm(decoder, output);
  collectPcm(decoder, output);
  const status = decoder.status();
  decoder.destroy();
  return {pcm: Buffer.concat(output), status};
}

const raw = await decodeRaw();
const cmaf = await decodeCmaf();
if (!raw.pcm.equals(cmaf.pcm)) {
  throw new Error(`RAW_VS_CMAF_PCM differs at byte ${raw.pcm.findIndex((value, index) => value !== cmaf.pcm[index])}`);
}
for (const key of ['sampleRate', 'outputChannels', 'decodedAccessUnits', 'outputFrames', 'outputSamples', 'profile', 'downmixIndex', 'objectCount', 'complexityIndex']) {
  if (raw.status[key] !== cmaf.status[key]) throw new Error(`RAW_VS_CMAF metadata mismatch: ${key}`);
}
console.log(`RAW_VS_CMAF_PCM=BIT_IDENTICAL bytes=${raw.pcm.length}`);
console.log(`CMAF access_units=${cmaf.status.decodedAccessUnits} frames=${cmaf.status.outputFrames} samples=${cmaf.status.outputSamples} sample_rate=${cmaf.status.sampleRate} channels=${cmaf.status.outputChannels}`);
