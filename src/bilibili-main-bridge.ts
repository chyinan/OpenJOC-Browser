// pattern: Imperative Shell

(function (): void {

type MainBridgeCandidate = {
  readonly id: string;
  readonly source: 'dolby' | 'ec-3';
  readonly codecs: string | null;
  readonly mimeType: string | null;
  readonly bandwidth: number | null;
  readonly baseUrl: string;
  readonly backupUrls: ReadonlyArray<string>;
};

type MainBridgePageState = {
  readonly bvid: string;
  readonly aid: string;
  readonly cid: string;
};

const PAGE_ORIGIN = 'https://www.bilibili.com';
const API_ORIGIN = 'https://api.bilibili.com';
const BRIDGE_SOURCE = 'openjoc-bilibili';
let lastManifestUrl: string | null = null;
let manifestRequestInFlight = false;
const knownMediaUrls = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function property(value: Record<string, unknown> | null, key: string): unknown {
  return value !== null && Object.hasOwn(value, key) ? value[key] : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function stringValue(first: unknown, second: unknown): string | null {
  return nonEmptyString(first) ? first : nonEmptyString(second) ? second : null;
}

function identifierValue(first: unknown, second: unknown): string | null {
  if (nonEmptyString(first)) return first;
  if (typeof first === 'number' && Number.isSafeInteger(first) && first >= 0) return String(first);
  if (nonEmptyString(second)) return second;
  return typeof second === 'number' && Number.isSafeInteger(second) && second >= 0 ? String(second) : null;
}

function arrayValue(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

function pageState(): MainBridgePageState | null {
  const pageWindow = window as Window & {readonly __INITIAL_STATE__?: unknown};
  const root = record(pageWindow.__INITIAL_STATE__);
  const videoData = record(property(root, 'videoData'));
  const bvid = stringValue(property(videoData, 'bvid'), property(root, 'bvid'));
  const aid = identifierValue(property(videoData, 'aid'), property(root, 'aid'));
  const cid = identifierValue(property(videoData, 'cid'), property(root, 'cid'));
  return bvid !== null && aid !== null && cid !== null ? {bvid, aid, cid} : null;
}

function manifestUrl(): string | null {
  const entry = performance.getEntriesByType('resource')
    .map((resource) => resource.name)
    .reverse()
    .find((name) => {
      try {
        const url = new URL(name);
        return url.origin === API_ORIGIN && url.pathname === '/x/player/wbi/playurl';
      } catch {
        return false;
      }
    });
  return entry ?? null;
}

function emit(message: Readonly<Record<string, unknown>>): void {
  window.postMessage(message, PAGE_ORIGIN);
}

function candidatesFromPayload(payload: unknown): ReadonlyArray<MainBridgeCandidate> {
  const root = record(payload);
  const data = record(property(root, 'data'));
  const dash = record(property(data, 'dash'));
  const result: Array<MainBridgeCandidate> = [];
  const seen = new Set<string>();
  collect(arrayValue(property(record(property(dash, 'dolby')), 'audio')), 'dolby', result, seen);
  collect(arrayValue(property(dash, 'audio')), 'ec-3', result, seen);
  collect(arrayValue(property(record(property(data, 'dolby')), 'audio')), 'dolby', result, seen);
  return result;
}

function collect(
  values: ReadonlyArray<unknown>,
  source: 'dolby' | 'ec-3',
  result: Array<MainBridgeCandidate>,
  seen: Set<string>,
): void {
  values.forEach((value, index) => {
    const candidate = record(value);
    const baseUrl = stringValue(property(candidate, 'baseUrl'), property(candidate, 'base_url'));
    const codecs = stringValue(property(candidate, 'codecs'), null);
    if (baseUrl === null || (source === 'ec-3' && !(codecs?.toLowerCase().includes('ec-3') ?? false))) return;
    const rawId = property(candidate, 'id');
    const id = nonEmptyString(rawId)
      ? rawId
      : typeof rawId === 'number' && Number.isSafeInteger(rawId)
        ? String(rawId)
        : `${source}-${index}`;
    const key = `${source}:${id}:${baseUrl}`;
    if (seen.has(key)) return;
    seen.add(key);
    const rawBackup = property(candidate, 'backupUrl') ?? property(candidate, 'backup_url');
    result.push({
      id,
      source,
      codecs,
      mimeType: stringValue(property(candidate, 'mimeType'), property(candidate, 'mime_type')),
      bandwidth: typeof property(candidate, 'bandwidth') === 'number' && Number.isFinite(property(candidate, 'bandwidth')) ? property(candidate, 'bandwidth') as number : null,
      baseUrl,
      backupUrls: arrayValue(rawBackup).filter((url): url is string => typeof url === 'string'),
    });
  });
}

function isCurrentManifestUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === API_ORIGIN && url.pathname === '/x/player/wbi/playurl';
  } catch {
    return false;
  }
}

function isAllowedMediaRangeMessage(value: Record<string, unknown>): boolean {
  if (value.source !== 'openjoc-content' || value.type !== 'fetch-media-range' || !nonEmptyString(value.requestId) || !nonEmptyString(value.url) || !Number.isSafeInteger(value.start) || !Number.isSafeInteger(value.end)) return false;
  const start = value.start as number;
  const end = value.end as number;
  try {
    const url = new URL(value.url as string);
    return knownMediaUrls.has(value.url as string) && url.protocol === 'https:' && url.username === '' && url.password === '' && (url.hostname === 'bilivideo.com' || url.hostname.endsWith('.bilivideo.com')) && url.pathname.toLowerCase().endsWith('.m4s') && start >= 0 && end >= start && end - start + 1 <= 4 * 1024 * 1024;
  } catch {
    return false;
  }
}

async function fetchManifest(url: string): Promise<void> {
  if (manifestRequestInFlight || !isCurrentManifestUrl(url)) return;
  manifestRequestInFlight = true;
  try {
    const response = await fetch(url, {credentials: 'include'});
    if (!response.ok) {
      emit({source: BRIDGE_SOURCE, type: 'unavailable', pageOrigin: PAGE_ORIGIN, pageUrl: location.href, reason: `playback manifest returned status ${response.status}`});
      return;
    }
    const candidates = candidatesFromPayload(await response.json());
    const identity = pageState();
    if (identity === null) return;
    if (candidates.length === 0) {
      emit({source: BRIDGE_SOURCE, type: 'unavailable', pageOrigin: PAGE_ORIGIN, pageUrl: location.href, reason: 'JOC stream unavailable for the current Bilibili session'});
      return;
    }
    candidates.forEach((candidate) => {
      knownMediaUrls.add(candidate.baseUrl);
      candidate.backupUrls.forEach((url) => knownMediaUrls.add(url));
    });
    emit({source: BRIDGE_SOURCE, type: 'manifest', pageOrigin: PAGE_ORIGIN, pageUrl: location.href, mediaKey: identity, candidates});
  } catch {
    emit({source: BRIDGE_SOURCE, type: 'unavailable', pageOrigin: PAGE_ORIGIN, pageUrl: location.href, reason: 'failed to read the current Bilibili playback manifest'});
  } finally {
    manifestRequestInFlight = false;
  }
}

function scan(force = false): void {
  const next = manifestUrl();
  if (next === null || (!force && next === lastManifestUrl)) return;
  lastManifestUrl = next;
  void fetchManifest(next);
}

window.addEventListener('message', (event: MessageEvent<unknown>): void => {
  if (event.source !== window || !isRecord(event.data)) return;
  if (event.data.source === 'openjoc-content' && event.data.type === 'request-manifest') {
    scan(true);
    return;
  }
  if (!isAllowedMediaRangeMessage(event.data)) return;
  const requestId = event.data.requestId as string;
  const url = event.data.url as string;
  const start = event.data.start as number;
  const end = event.data.end as number;
  void (async (): Promise<void> => {
    try {
      const response = await fetch(url, {credentials: 'include', headers: {Range: `bytes=${start}-${end}`}, referrer: location.href, referrerPolicy: 'no-referrer-when-downgrade'});
      const contentRange = response.headers.get('content-range');
      const buffer = response.status === 206 ? await response.arrayBuffer() : new ArrayBuffer(0);
      const message = {source: BRIDGE_SOURCE, type: 'media-range-response', pageOrigin: PAGE_ORIGIN, pageUrl: location.href, requestId, status: response.status, contentRange, error: null, buffer};
      window.postMessage(message, PAGE_ORIGIN, buffer.byteLength === 0 ? [] : [buffer]);
    } catch (error: unknown) {
      const message = {source: BRIDGE_SOURCE, type: 'media-range-response', pageOrigin: PAGE_ORIGIN, pageUrl: location.href, requestId, status: 0, contentRange: null, error: error instanceof Error ? error.message : 'page-context CMAF range fetch failed', buffer: new ArrayBuffer(0)};
      window.postMessage(message, PAGE_ORIGIN);
    }
  })();
});

window.setInterval((): void => scan(), 1_000);
scan();
})();
