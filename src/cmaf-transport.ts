// pattern: Functional Core

/** The generic ISO-BMFF facts needed by the browser CMAF fetch shell. */
export type CmafInitInfo = Readonly<{
  readonly trackId: number;
  readonly timescale: number;
  readonly handlerType: string;
  readonly sampleEntry: string;
  readonly hasDecoderConfig: boolean;
  readonly isEncrypted: boolean;
}>;

/** One byte-addressed reference from an ISO-BMFF segment index. */
export type CmafSegmentReference = Readonly<{
  readonly byteRangeStart: number;
  readonly byteRangeEnd: number;
  readonly ptsSamples: number;
  readonly durationSamples: number;
}>;

/** A bounded sidx index with media-time and byte ranges resolved. */
export type CmafSegmentIndex = Readonly<{
  readonly timescale: number;
  readonly earliestPresentationTime: number;
  readonly references: ReadonlyArray<CmafSegmentReference>;
}>;

/** One exact compressed CMAF sample with its track-timeline timestamp. */
export type CmafSample = Readonly<{
  readonly bytes: Uint8Array;
  readonly ptsSamples: number;
  readonly durationSamples: number;
}>;

type IsoBox = Readonly<{
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly headerSize: number;
  readonly payloadStart: number;
}>;

const MAX_BOX_BYTES = 32 * 1024 * 1024;
const MAX_SAMPLE_COUNT = 512;
const MAX_SEGMENT_REFERENCES = 4_096;
const CONTAINER_BOX_TYPES = new Set(['edts', 'dinf', 'ilst', 'mdia', 'meta', 'minf', 'moof', 'moov', 'mvex', 'mfra', 'schi', 'sinf', 'stbl', 'trak', 'traf', 'udta', 'wave']);

/** Parses the selected audio track from an ISO-BMFF initialization segment. */
export function parseCmafInitSegment(bytes: Readonly<Uint8Array>): CmafInitInfo {
  const topLevel = parseBoxes(bytes, 0, bytes.length, true);
  const moov = requireBox(topLevel, 'moov');
  for (const trak of childBoxes(bytes, moov, 'trak')) {
    const mdia = findChild(bytes, trak, 'mdia');
    const hdlr = mdia === null ? null : findChild(bytes, mdia, 'hdlr');
    const mdhd = mdia === null ? null : findChild(bytes, mdia, 'mdhd');
    const stsd = findSampleDescription(bytes, mdia);
    if (hdlr === null || mdhd === null || stsd === null) {
      continue;
    }
    const handlerType = readFourCc(bytes, hdlr.payloadStart + 8);
    if (handlerType !== 'soun') {
      continue;
    }
    const sampleEntryBox = parseSingleBox(bytes, stsd.payloadStart + 8, stsd.end);
    const sampleEntry = sampleEntryBox.type;
    const trackHeader = findChild(bytes, trak, 'tkhd');
    if (trackHeader === null) {
      throw new Error('CMAF audio track is missing tkhd');
    }
    const trackId = readTrackId(bytes, trackHeader);
    const timescale = readMediaTimescale(bytes, mdhd);
    const childStart = sampleEntryBox.start + 36;
    const hasDecoderConfig = childStart <= sampleEntryBox.end
      && findDescendantInRange(bytes, childStart, sampleEntryBox.end, 'dec3') !== null;
    const isEncrypted = sampleEntry === 'enca'
      || (childStart <= sampleEntryBox.end && (findDescendantInRange(bytes, childStart, sampleEntryBox.end, 'sinf') !== null || findDescendantInRange(bytes, childStart, sampleEntryBox.end, 'schm') !== null))
      || topLevel.some((box_) => box_.type === 'pssh');
    return {trackId, timescale, handlerType, sampleEntry, hasDecoderConfig, isEncrypted};
  }
  throw new Error('CMAF initialization segment has no audio track');
}

/** Parses a top-level ISO-BMFF sidx into bounded absolute byte ranges. */
export function parseCmafSegmentIndex(bytes: Readonly<Uint8Array>): CmafSegmentIndex {
  const topLevel = parseBoxes(bytes, 0, bytes.length, true);
  const sidx = requireBox(topLevel, 'sidx');
  const versionFlags = readU32(bytes, sidx.payloadStart);
  const version = versionFlags >>> 24;
  if (version !== 0 && version !== 1) {
    throw new Error(`unsupported sidx version: ${version}`);
  }
  const timescale = readU32(bytes, sidx.payloadStart + 8);
  if (timescale === 0) {
    throw new Error('sidx timescale must be positive');
  }
  let cursor = sidx.payloadStart + 12;
  const earliest = version === 0 ? BigInt(readU32(bytes, cursor)) : readU64(bytes, cursor);
  cursor += version === 0 ? 4 : 8;
  const firstOffset = version === 0 ? BigInt(readU32(bytes, cursor)) : readU64(bytes, cursor);
  cursor += version === 0 ? 4 : 8;
  const referenceCount = readU16(bytes, cursor + 2);
  if (referenceCount > MAX_SEGMENT_REFERENCES) {
    throw new Error(`sidx reference count exceeds ${MAX_SEGMENT_REFERENCES}`);
  }
  cursor += 4;
  const firstReferenceStart = BigInt(sidx.end) + firstOffset;
  const references: Array<CmafSegmentReference> = [];
  let byteStart = firstReferenceStart;
  let pts = earliest;
  for (let index = 0; index < referenceCount; index += 1) {
    if (cursor + 12 > sidx.end) throw new Error('truncated sidx reference table');
    const reference = readU32(bytes, cursor);
    cursor += 4;
    if ((reference & 0x8000_0000) !== 0) {
      throw new Error('hierarchical sidx references are unsupported');
    }
    const size = reference & 0x7fff_ffff;
    const duration = readU32(bytes, cursor);
    cursor += 4;
    cursor += 4;
    if (size === 0 || duration === 0) {
      throw new Error('sidx reference size and duration must be positive');
    }
    const start = safeNumber(byteStart, 'sidx byte range start');
    const end = safeNumber(byteStart + BigInt(size) - 1n, 'sidx byte range end');
    references.push({
      byteRangeStart: start,
      byteRangeEnd: end,
      ptsSamples: safeNumber(pts, 'sidx presentation time'),
      durationSamples: duration,
    });
    byteStart += BigInt(size);
    pts += BigInt(duration);
  }
  return {
    timescale,
    earliestPresentationTime: safeNumber(earliest, 'sidx earliest presentation time'),
    references,
  };
}

/** Extracts exact samples and track-timeline timestamps from one moof/mdat. */
export function parseCmafFragment(
  bytes: Readonly<Uint8Array>,
  trackId: number,
): ReadonlyArray<CmafSample> {
  if (!Number.isSafeInteger(trackId) || trackId <= 0) {
    throw new Error('CMAF track id must be a positive safe integer');
  }
  const topLevel = parseBoxes(bytes, 0, bytes.length);
  const moof = requireBox(topLevel, 'moof');
  const mdat = requireBox(topLevel, 'mdat');
  const traf = childBoxes(bytes, moof, 'traf').find((candidate) => {
    const tfhd = findChild(bytes, candidate, 'tfhd');
    return tfhd !== null && readU32(bytes, tfhd.payloadStart + 4) === trackId;
  });
  if (traf === undefined) {
    throw new Error(`CMAF fragment has no track ${trackId}`);
  }
  const tfhd = findChild(bytes, traf, 'tfhd');
  const tfdt = findChild(bytes, traf, 'tfdt');
  if (tfhd === null || tfdt === null) {
    throw new Error('CMAF fragment is missing tfhd or tfdt');
  }
  const defaults = parseTrackDefaults(bytes, tfhd);
  let decodeTime = readDecodeTime(bytes, tfdt);
  let dataCursor = mdat.payloadStart;
  const samples: Array<CmafSample> = [];
  for (const trun of childBoxes(bytes, traf, 'trun')) {
    const parsed = parseRun(bytes, trun, defaults, decodeTime, moof.start, dataCursor, mdat.payloadStart, mdat.end);
    samples.push(...parsed.samples);
    decodeTime = parsed.nextDecodeTime;
    dataCursor = parsed.nextDataCursor;
  }
  if (samples.length === 0) {
    throw new Error('CMAF fragment has no samples');
  }
  return samples;
}

type TrackDefaults = Readonly<{
  readonly durationSamples: number | null;
  readonly sizeBytes: number | null;
}>;

type ParsedRun = Readonly<{
  readonly samples: ReadonlyArray<CmafSample>;
  readonly nextDecodeTime: bigint;
  readonly nextDataCursor: number;
}>;

function parseTrackDefaults(bytes: Readonly<Uint8Array>, tfhd: IsoBox): TrackDefaults {
  const flags = readU32(bytes, tfhd.payloadStart) & 0x00ff_ffff;
  let cursor = tfhd.payloadStart + 8;
  if ((flags & 0x000001) !== 0) cursor += 8;
  if ((flags & 0x000002) !== 0) cursor += 4;
  let durationSamples: number | null = null;
  let sizeBytes: number | null = null;
  if ((flags & 0x000008) !== 0) {
    durationSamples = readU32(bytes, cursor);
    cursor += 4;
  }
  if ((flags & 0x000010) !== 0) {
    sizeBytes = readU32(bytes, cursor);
  }
  return {durationSamples, sizeBytes};
}

function parseRun(
  bytes: Readonly<Uint8Array>,
  trun: IsoBox,
  defaults: TrackDefaults,
  decodeTime: bigint,
  moofStart: number,
  fallbackDataCursor: number,
  dataStart: number,
  dataEnd: number,
): ParsedRun {
  const versionFlags = readU32(bytes, trun.payloadStart);
  const version = versionFlags >>> 24;
  const flags = versionFlags & 0x00ff_ffff;
  if (version !== 0 && version !== 1) {
    throw new Error(`unsupported trun version: ${version}`);
  }
  const sampleCount = readU32(bytes, trun.payloadStart + 4);
  if (sampleCount === 0 || sampleCount > MAX_SAMPLE_COUNT) {
    throw new Error(`CMAF trun sample count exceeds ${MAX_SAMPLE_COUNT}`);
  }
  let cursor = trun.payloadStart + 8;
  let dataCursor = fallbackDataCursor;
  if ((flags & 0x000001) !== 0) {
    dataCursor = moofStart + readI32(bytes, cursor);
    cursor += 4;
  }
  if ((flags & 0x000004) !== 0) cursor += 4;
  const samples: Array<CmafSample> = [];
  let nextDecodeTime = decodeTime;
  for (let index = 0; index < sampleCount; index += 1) {
    const durationSamples = (flags & 0x000100) !== 0
      ? readU32(bytes, cursor)
      : defaults.durationSamples;
    if (durationSamples === null || durationSamples === 0) {
      throw new Error('CMAF sample duration is not declared');
    }
    if ((flags & 0x000100) !== 0) cursor += 4;
    const sizeBytes = (flags & 0x000200) !== 0 ? readU32(bytes, cursor) : defaults.sizeBytes;
    if (sizeBytes === null || sizeBytes === 0) {
      throw new Error('CMAF sample size is not declared');
    }
    if ((flags & 0x000200) !== 0) cursor += 4;
    if ((flags & 0x000400) !== 0) cursor += 4;
    let compositionOffset = 0;
    if ((flags & 0x000800) !== 0) {
      compositionOffset = version === 1 ? readI32(bytes, cursor) : readU32(bytes, cursor);
      cursor += 4;
    }
    if (dataCursor < dataStart || dataCursor + sizeBytes > dataEnd) {
      throw new Error('CMAF sample exceeds the fetched media range');
    }
    const ptsSamples = nextDecodeTime + BigInt(compositionOffset);
    if (ptsSamples < 0n) {
      throw new Error('CMAF sample PTS must not be negative');
    }
    samples.push({
      bytes: bytes.slice(dataCursor, dataCursor + sizeBytes),
      ptsSamples: safeNumber(ptsSamples, 'CMAF sample PTS'),
      durationSamples,
    });
    dataCursor += sizeBytes;
    nextDecodeTime += BigInt(durationSamples);
  }
  return {samples, nextDecodeTime, nextDataCursor: dataCursor};
}

function findSampleDescription(
  bytes: Readonly<Uint8Array>,
  mdia: IsoBox | null,
): IsoBox | null {
  if (mdia === null) return null;
  const minf = findChild(bytes, mdia, 'minf');
  const stbl = minf === null ? null : findChild(bytes, minf, 'stbl');
  return stbl === null ? null : findChild(bytes, stbl, 'stsd');
}

function readTrackId(bytes: Readonly<Uint8Array>, tkhd: IsoBox): number {
  const version = readU32(bytes, tkhd.payloadStart) >>> 24;
  return readU32(bytes, tkhd.payloadStart + (version === 0 ? 12 : 20));
}

function readMediaTimescale(bytes: Readonly<Uint8Array>, mdhd: IsoBox): number {
  const version = readU32(bytes, mdhd.payloadStart) >>> 24;
  const offset = version === 0 ? 12 : 20;
  const timescale = readU32(bytes, mdhd.payloadStart + offset);
  if (timescale === 0) throw new Error('CMAF media timescale must be positive');
  return timescale;
}

function readDecodeTime(bytes: Readonly<Uint8Array>, tfdt: IsoBox): bigint {
  const version = readU32(bytes, tfdt.payloadStart) >>> 24;
  if (version === 0) return BigInt(readU32(bytes, tfdt.payloadStart + 4));
  if (version === 1) return readU64(bytes, tfdt.payloadStart + 4);
  throw new Error(`unsupported tfdt version: ${version}`);
}

function parseBoxes(
  bytes: Readonly<Uint8Array>,
  start: number,
  end: number,
  allowTrailing = false,
): ReadonlyArray<IsoBox> {
  const result: Array<IsoBox> = [];
  let cursor = start;
  while (cursor < end) {
    if (cursor + 8 > end) {
      if (allowTrailing) break;
      throw new Error('truncated ISO-BMFF box header');
    }
    const declaredSize = readU32(bytes, cursor);
    let size = declaredSize;
    let headerSize = 8;
    if (declaredSize === 1) {
      size = safeNumber(readU64(bytes, cursor + 8), 'extended ISO-BMFF box size');
      headerSize = 16;
    } else if (declaredSize === 0) {
      size = end - cursor;
    }
    if (size < headerSize || size > MAX_BOX_BYTES || cursor + size > end) {
      if (allowTrailing && cursor + size > end) break;
      throw new Error('invalid or unbounded ISO-BMFF box size');
    }
    result.push({
      type: readFourCc(bytes, cursor + 4),
      start: cursor,
      end: cursor + size,
      headerSize,
      payloadStart: cursor + headerSize,
    });
    cursor += size;
  }
  return result;
}

function childBoxes(
  bytes: Readonly<Uint8Array>,
  parent: IsoBox,
  type: string,
): ReadonlyArray<IsoBox> {
  return parseBoxes(bytes, parent.payloadStart, parent.end).filter((box_) => box_.type === type);
}

function findChild(bytes: Readonly<Uint8Array>, parent: IsoBox, type: string): IsoBox | null {
  return childBoxes(bytes, parent, type)[0] ?? null;
}

function findDescendant(bytes: Readonly<Uint8Array>, parent: IsoBox, type: string): IsoBox | null {
  for (const child of parseBoxes(bytes, parent.payloadStart, parent.end)) {
    if (child.type === type) return child;
    if (CONTAINER_BOX_TYPES.has(child.type)) {
      const nested = findDescendant(bytes, child, type);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function findDescendantInRange(
  bytes: Readonly<Uint8Array>,
  start: number,
  end: number,
  type: string,
): IsoBox | null {
  for (const child of parseBoxes(bytes, start, end)) {
    if (child.type === type) return child;
    if (CONTAINER_BOX_TYPES.has(child.type)) {
      const nested = findDescendant(bytes, child, type);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function parseSingleBox(bytes: Readonly<Uint8Array>, start: number, end: number): IsoBox {
  const boxes = parseBoxes(bytes, start, end);
  if (boxes.length !== 1 || boxes[0] === undefined || boxes[0].end !== end) {
    throw new Error('expected one complete ISO-BMFF box');
  }
  return boxes[0];
}

function requireBox(boxes: ReadonlyArray<IsoBox>, type: string): IsoBox {
  const box = boxes.find((candidate) => candidate.type === type);
  if (box === undefined) throw new Error(`CMAF is missing ${type} box`);
  return box;
}

function readFourCc(bytes: Readonly<Uint8Array>, offset: number): string {
  if (offset < 0 || offset + 4 > bytes.length) throw new Error('truncated ISO-BMFF fourcc');
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
}

function readU16(bytes: Readonly<Uint8Array>, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) throw new Error('truncated ISO-BMFF uint16');
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readU32(bytes: Readonly<Uint8Array>, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw new Error('truncated ISO-BMFF uint32');
  return ((bytes[offset] ?? 0) * 0x1_000_000) + ((bytes[offset + 1] ?? 0) * 0x1_0000) + ((bytes[offset + 2] ?? 0) * 0x100) + (bytes[offset + 3] ?? 0);
}

function readI32(bytes: Readonly<Uint8Array>, offset: number): number {
  const value = readU32(bytes, offset);
  return value > 0x7fff_ffff ? value - 0x1_0000_0000 : value;
}

function readU64(bytes: Readonly<Uint8Array>, offset: number): bigint {
  if (offset < 0 || offset + 8 > bytes.length) throw new Error('truncated ISO-BMFF uint64');
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0);
  }
  return value;
}

function safeNumber(value: bigint, description: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${description} exceeds the safe integer bound`);
  }
  return Number(value);
}
