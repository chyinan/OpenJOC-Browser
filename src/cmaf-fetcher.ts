// pattern: Imperative Shell

import {parseCmafFragment, parseCmafInitSegment, parseCmafSegmentIndex, type CmafInitInfo, type CmafSample, type CmafSegmentIndex, type CmafSegmentReference} from './cmaf-transport.js';
import {isAllowedBilibiliMediaUrl, sanitizeMediaUrl} from './media-url-policy.js';

const CMAF_TIMESCALE = 48_000;
const INIT_RANGE_END = 8_191;
const MAX_RANGE_BYTES = 4 * 1024 * 1024;
const RANGE_TIMEOUT_MS = 5_000;

export type CmafFetchOptions = Readonly<{
  readonly url: string;
  readonly pageUrl: string;
}>;

type CmafRangeOptions = CmafFetchOptions & Readonly<{
  readonly signal: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}>;

export type CmafIndexSession = Readonly<{
  readonly url: string;
  readonly pageUrl: string;
  readonly totalBytes: number;
  readonly init: CmafInitInfo;
  readonly index: CmafSegmentIndex;
}>;

type RangeResponse = Readonly<{
  readonly bytes: Uint8Array;
  readonly totalBytes: number;
}>;

/** Fetches only the bounded initialization/index range for a Bilibili CMAF source. */
export async function fetchCmafIndex(options: CmafRangeOptions): Promise<CmafIndexSession> {
  if (!isAllowedBilibiliMediaUrl(options.url, options.pageUrl)) {
    throw new Error(`rejected Bilibili media URL: ${sanitizeMediaUrl(options.url)}`);
  }
  const response = await fetchRange(options, 0, INIT_RANGE_END, options.signal);
  const init = parseCmafInitSegment(response.bytes);
  const index = parseCmafSegmentIndex(response.bytes);
  if (init.isEncrypted) {
    throw new Error('DRM / encrypted representation unsupported');
  }
  if (init.sampleEntry !== 'ec-3' || !init.hasDecoderConfig) {
    throw new Error('Bilibili representation is not a CMAF E-AC-3 track');
  }
  if (init.timescale !== CMAF_TIMESCALE || index.timescale !== CMAF_TIMESCALE) {
    throw new Error('Bilibili CMAF track does not use the supported 48000 Hz timeline');
  }
  for (const reference of index.references) {
    if (reference.byteRangeEnd >= response.totalBytes) {
      throw new Error('Bilibili CMAF segment range exceeds the media resource');
    }
  }
  return {url: options.url, pageUrl: options.pageUrl, totalBytes: response.totalBytes, init, index};
}

/** Fetches one indexed fMP4 fragment and returns its exact timestamped samples. */
export async function fetchCmafSegment(
  session: CmafIndexSession,
  reference: CmafSegmentReference,
  signal: AbortSignal,
): Promise<ReadonlyArray<CmafSample>> {
  if (reference.byteRangeStart < 0 || reference.byteRangeEnd < reference.byteRangeStart || reference.byteRangeEnd >= session.totalBytes) {
    throw new Error('Bilibili CMAF segment range is invalid');
  }
  const range = await fetchRange({url: session.url, pageUrl: session.pageUrl, signal}, reference.byteRangeStart, reference.byteRangeEnd, signal);
  if (range.bytes.length > MAX_RANGE_BYTES) {
    throw new Error('Bilibili CMAF segment exceeds the bounded range limit');
  }
  return parseCmafFragment(range.bytes, session.init.trackId);
}

async function fetchRange(
  options: CmafRangeOptions,
  start: number,
  end: number,
  signal: AbortSignal,
): Promise<RangeResponse> {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end - start + 1 > MAX_RANGE_BYTES) {
    throw new Error('CMAF byte range is outside the bounded fetch limit');
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestController = new AbortController();
  let timedOut = false;
  const abortFromCaller = (): void => requestController.abort();
  if (signal.aborted) requestController.abort();
  else signal.addEventListener('abort', abortFromCaller, {once: true});
  const timeoutId = globalThis.setTimeout((): void => {
    timedOut = true;
    requestController.abort();
  }, RANGE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(options.url, {
      method: 'GET',
      credentials: 'include',
      headers: {Range: `bytes=${start}-${end}`},
      referrer: options.pageUrl,
      referrerPolicy: 'no-referrer-when-downgrade',
      signal: requestController.signal,
    });
    if (response.status !== 206) {
      throw new Error(`Bilibili CMAF range request returned status ${response.status} for bytes ${start}-${end}`);
    }
    const contentRange = parseContentRange(response.headers.get('content-range'));
    if (contentRange === null || contentRange.start !== start || contentRange.end < start || contentRange.end > end) {
      throw new Error('Bilibili CMAF range response is invalid');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== contentRange.end - contentRange.start + 1) {
      throw new Error('Bilibili CMAF range length does not match Content-Range');
    }
    return {bytes, totalBytes: contentRange.total};
  } catch (error: unknown) {
    if (timedOut && !signal.aborted) throw new Error(`Bilibili CMAF range request timed out for bytes ${start}-${end}`);
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal.removeEventListener('abort', abortFromCaller);
  }
}

function parseContentRange(value: string | null): Readonly<{start: number; end: number; total: number}> | null {
  if (value === null) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value);
  if (match === null) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total <= end) return null;
  return {start, end, total};
}
