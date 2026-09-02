// pattern: Functional Core

import {parseCmafFragment, parseCmafInitSegment, parseCmafSegmentIndex} from '../src/cmaf-transport.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function box(type: string, payload: ReadonlyArray<number>): Array<number> {
  const bytes = new Array<number>();
  const size = payload.length + 8;
  bytes.push((size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff);
  for (const character of type) {
    bytes.push(character.charCodeAt(0));
  }
  bytes.push(...payload);
  return bytes;
}

function fullBox(type: string, versionFlags: number, payload: ReadonlyArray<number>): Array<number> {
  return box(type, [
    (versionFlags >>> 24) & 0xff,
    (versionFlags >>> 16) & 0xff,
    (versionFlags >>> 8) & 0xff,
    versionFlags & 0xff,
    ...payload,
  ]);
}

function u32(value: number): Array<number> {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u64(value: number): Array<number> {
  return [...u32(Math.floor(value / 0x1_0000_0000)), ...u32(value >>> 0)];
}

function makeInit(): Uint8Array {
  const mdhd = fullBox('mdhd', 0x0100_0000, [...u64(0), ...u64(0), ...u32(48_000), ...u64(0), 0, 0]);
  const hdlr = fullBox('hdlr', 0, [0, 0, 0, 0, ...Array.from('soun', (character) => character.charCodeAt(0)), ...Array<number>(12).fill(0)]);
  const dec3 = box('dec3', [0, 0, 0, 0, 0, 0, 0, 0]);
  const stsd = fullBox('stsd', 0, [0, 0, 0, 1, ...box('ec-3', [...Array<number>(28).fill(0), ...dec3])]);
  const stbl = box('stbl', stsd);
  const minf = box('minf', stbl);
  const mdia = box('mdia', [
    ...mdhd,
    ...hdlr,
    ...minf,
  ]);
  const trak = box('trak', [
    ...box('tkhd', [...Array<number>(12).fill(0), ...u32(1), ...Array<number>(52).fill(0)]),
    ...mdia,
  ]);
  return new Uint8Array([...box('ftyp', [...Array<number>(16).fill(0)]), ...box('moov', trak)]);
}

function makeSidx(): Uint8Array {
  const payload = [
    ...u32(1),
    ...u32(48_000),
    ...u64(0),
    ...u64(0),
    0, 0,
    0, 2,
    ...u32(0x0000_0064), ...u32(1_536), ...u32(0x9000_0000),
    ...u32(0x0000_0065), ...u32(1_536), ...u32(0x9000_0000),
  ];
  return new Uint8Array(box('sidx', [0x01, 0, 0, 0, ...payload]));
}

function makeFragment(): Uint8Array {
  const first = [1, 2, 3, 4];
  const second = [5, 6, 7, 8, 9];
  const tfhd = fullBox('tfhd', 0x0000_0000, [...u32(1)]);
  const tfdt = fullBox('tfdt', 0x0100_0000, [...u64(1_536)]);
  const trunPayload = [
    ...u32(2),
    0, 0, 0, 0,
    ...u32(1_536), ...u32(first.length),
    ...u32(1_536), ...u32(second.length),
  ];
  const trun = fullBox('trun', 0x0000_0301, trunPayload);
  const traf = box('traf', [...tfhd, ...tfdt, ...trun]);
  const moof = box('moof', [...fullBox('mfhd', 0, [...u32(1)]), ...traf]);
  const dataOffset = moof.length + 8;
  const patchedTrunPayload = [
    ...u32(2),
    ...u32(dataOffset),
    ...u32(1_536), ...u32(first.length),
    ...u32(1_536), ...u32(second.length),
  ];
  const patchedTrun = fullBox('trun', 0x0000_0301, patchedTrunPayload);
  const patchedTraf = box('traf', [...tfhd, ...tfdt, ...patchedTrun]);
  const patchedMoof = box('moof', [...fullBox('mfhd', 0, [...u32(1)]), ...patchedTraf]);
  return new Uint8Array([...patchedMoof, ...box('mdat', [...first, ...second])]);
}

function run(): void {
  const initBytes = makeInit();
  const init = parseCmafInitSegment(initBytes);
  assert(init.trackId === 1, 'init exposes track id');
  assert(init.timescale === 48_000, 'init exposes timescale');
  assert(init.sampleEntry === 'ec-3', 'init exposes E-AC-3 sample entry');
  assert(init.hasDecoderConfig, 'init requires dec3 configuration');
  assert(!init.isEncrypted, 'clean CMAF fixture is not encrypted');

  const sidxBytes = makeSidx();
  const sidx = parseCmafSegmentIndex(new Uint8Array([...initBytes, ...sidxBytes]));
  assert(sidx.timescale === 48_000, 'sidx exposes timescale');
  assert(sidx.references.length === 2, 'sidx exposes references');
  assert(sidx.references[0]?.ptsSamples === 0, 'first sidx PTS');
  assert(sidx.references[1]?.ptsSamples === 1_536, 'second sidx PTS');
  assert(sidx.references[0]?.byteRangeStart === initBytes.length + sidxBytes.length, 'first sidx range starts after sidx');

  const samples = parseCmafFragment(makeFragment(), init.trackId);
  assert(samples.length === 2, 'fragment exposes two samples');
  assert(samples[0]?.ptsSamples === 1_536, 'fragment preserves tfdt PTS');
  assert(samples[1]?.ptsSamples === 3_072, 'fragment advances PTS by duration');
  assert(samples[0]?.durationSamples === 1_536, 'fragment preserves duration');
  assert(samples[0]?.bytes[0] === 1 && samples[1]?.bytes[0] === 5, 'fragment preserves sample bytes');
}

run();
