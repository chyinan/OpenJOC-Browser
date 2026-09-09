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

type MainBridgeManifest = Readonly<{
  readonly identity: MainBridgePageState;
  readonly routeKey: string;
  readonly candidates: ReadonlyArray<MainBridgeCandidate>;
}>;

const PAGE_ORIGIN = 'https://www.bilibili.com';
const API_ORIGIN = 'https://api.bilibili.com';
const BRIDGE_SOURCE = 'openjoc-bilibili';
let lastManifestUrl: string | null = null;
let lastPageManifestFingerprint: string | null = null;
const initialRouteKey = pageRouteKey();
let observedRouteKey = initialRouteKey;
let observedMediaKey: string | null = null;
let bootstrapManifest: MainBridgeManifest | null = null;
let canCaptureBootstrap = true;
let initialEmbeddedFingerprint: string | null = null;
let resolvedManifest: MainBridgeManifest | null = null;
let pendingManifest: Readonly<{url: string; abort: AbortController}> | null = null;
const knownMediaUrls = new Set<string>();
const observedManifestUrls: Array<string> = [];
const observedManifestUrlSet = new Set<string>();
const MAX_OBSERVED_MANIFEST_URLS = 100;
const bridgeTrace: Array<Readonly<Record<string, unknown>>> = [];

function isManifestResourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === API_ORIGIN && url.pathname === '/x/player/wbi/playurl';
  } catch {
    return false;
  }
}

function rememberManifestResource(value: string): void {
  if (!isManifestResourceUrl(value) || observedManifestUrlSet.has(value)) return;
  observedManifestUrlSet.add(value);
  observedManifestUrls.push(value);
  if (observedManifestUrls.length > MAX_OBSERVED_MANIFEST_URLS) {
    const removed = observedManifestUrls.shift();
    if (removed !== undefined) observedManifestUrlSet.delete(removed);
  }
}

function describePlayurlResources(names: ReadonlyArray<string>, identity: MainBridgePageState | null): Array<Readonly<Record<string, unknown>>> {
  const result: Array<Readonly<Record<string, unknown>>> = [];
  for (const name of names.slice().reverse()) {
    try {
      const url = new URL(name);
      if (url.origin !== API_ORIGIN || !url.pathname.includes('/player/')) continue;
      result.push({
        pathname: url.pathname,
        bvid: url.searchParams.get('bvid'),
        aid: url.searchParams.get('avid') ?? url.searchParams.get('aid'),
        cid: url.searchParams.get('cid'),
        isCurrentPlayurl: url.pathname === '/x/player/wbi/playurl',
        matchesPageIdentity: identity !== null && isCurrentManifestUrl(name, identity),
      });
      if (result.length >= 20) break;
    } catch {
      // Ignore malformed resource names in diagnostics.
    }
  }
  return result;
}

function recentPlayurlResources(identity: MainBridgePageState | null): Array<Readonly<Record<string, unknown>>> {
  return describePlayurlResources(performance.getEntriesByType('resource').map((resource) => resource.name), identity);
}

function observeManifestResources(): void {
  performance.getEntriesByType('resource').forEach((resource) => rememberManifestResource(resource.name));
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    const observer = new PerformanceObserver((list): void => {
      list.getEntries().forEach((entry) => rememberManifestResource(entry.name));
      updateBridgeDebug('resource-observed', {observedBatchSize: list.getEntries().length});
    });
    observer.observe({type: 'resource', buffered: true});
  } catch {
    // Resource Timing observation is optional; periodic scans remain available.
  }
}

function updateBridgeDebug(event: string, details: Readonly<Record<string, unknown>> = {}): void {
  const traceEntry = {atMs: Math.round(performance.now()), event, ...details};
  if (event !== 'scan' && event !== 'scan-awaiting-manifest') bridgeTrace.push(traceEntry);
  if (bridgeTrace.length > 30) bridgeTrace.shift();
  const root = document.documentElement;
  if (root === null) return;
  const identity = pageState();
  const embeddedCandidates = candidatesFromPayload(pagePlayinfo());
  root.dataset.openjocBridgeDebug = JSON.stringify({
    schemaVersion: 1,
    currentUrl: location.href,
    routeKey: pageRouteKey(),
    initialRouteKey,
    observedRouteKey,
    pageIdentity: mediaKey(identity),
    observedMediaKey,
    lastManifestUrl,
    pendingManifestUrl: pendingManifest?.url ?? null,
    resolvedManifestIdentity: resolvedManifest === null ? null : mediaKey(resolvedManifest.identity),
    resolvedManifestRouteKey: resolvedManifest?.routeKey ?? null,
    resolvedCandidateCount: resolvedManifest?.candidates.length ?? null,
    bootstrapManifestIdentity: bootstrapManifest === null ? null : mediaKey(bootstrapManifest.identity),
    embeddedCandidateCount: embeddedCandidates.length,
    embeddedFingerprintChanged: initialEmbeddedFingerprint === null ? null : candidatesFingerprint(embeddedCandidates) !== initialEmbeddedFingerprint,
    canCaptureBootstrap,
    resourceCount: performance.getEntriesByType('resource').length,
    playurlResources: recentPlayurlResources(identity),
    observedManifestResourceCount: observedManifestUrls.length,
    cachedPlayurlResources: describePlayurlResources(observedManifestUrls, identity),
    lastMeaningfulEvent: bridgeTrace.at(-1)?.event ?? null,
    knownMediaUrlCount: knownMediaUrls.size,
    event,
    trace: bridgeTrace,
  });
}

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

function pageRouteKey(): string {
  const url = new URL(location.href);
  return `${url.pathname.replace(/\/+$/, '')}:p=${url.searchParams.get('p') ?? '1'}`;
}

function mediaKey(identity: MainBridgePageState | null): string | null {
  return identity === null ? null : `${identity.bvid}:${identity.aid}:${identity.cid}`;
}

function requestIdentityForRoute(routeVideo: string | null): MainBridgePageState | null {
  const currentPart = new URL(location.href).searchParams.get('p') ?? '1';
  for (const resource of performance.getEntriesByType('resource').slice().reverse()) {
    try {
      const url = new URL(resource.name);
      // Without matching page state, a CID alone cannot prove which part is selected.
      if (url.searchParams.get('p') !== currentPart) continue;
      const bvid = url.searchParams.get('bvid');
      const aid = url.searchParams.get('avid') ?? url.searchParams.get('aid');
      const cid = url.searchParams.get('cid');
      if (!nonEmptyString(bvid) || !nonEmptyString(aid) || !nonEmptyString(cid)) continue;
      const identity = {bvid, aid, cid};
      if ((routeVideo === bvid || routeVideo === `av${aid}`) && isCurrentManifestUrl(resource.name, identity)) return identity;
    } catch {
      // Ignore non-playurl resource names.
    }
  }
  return null;
}

function pageState(): MainBridgePageState | null {
  const pageWindow = window as Window & {readonly __INITIAL_STATE__?: unknown; readonly __playinfo__?: unknown};
  const root = record(pageWindow.__INITIAL_STATE__);
  const videoData = record(property(root, 'videoData'));
  const bvid = stringValue(property(videoData, 'bvid'), property(root, 'bvid'));
  const aid = identifierValue(property(videoData, 'aid'), property(root, 'aid'));
  const pageUrl = new URL(location.href);
  const routeVideo = pageUrl.pathname.match(/^\/video\/([^/]+)/)?.[1] ?? null;
  if (routeVideo !== bvid && routeVideo !== `av${aid}`) return requestIdentityForRoute(routeVideo);
  const part = Number(pageUrl.searchParams.get('p') ?? '1');
  const selectedPage = Number.isSafeInteger(part) && part > 0 ? record(arrayValue(property(videoData, 'pages'))[part - 1]) : null;
  if (!Number.isSafeInteger(part) || part < 1) return null;
  if (part > 1 && identifierValue(property(selectedPage, 'cid'), null) === null) return requestIdentityForRoute(routeVideo);
  const cid = identifierValue(property(selectedPage, 'cid'), identifierValue(property(videoData, 'cid'), property(root, 'cid')));
  return bvid !== null && aid !== null && cid !== null ? {bvid, aid, cid} : null;
}

function pagePlayinfo(): unknown {
  const pageWindow = window as Window & {readonly __playinfo__?: unknown};
  return pageWindow.__playinfo__;
}

function manifestUrl(identity: MainBridgePageState): string | null {
  performance.getEntriesByType('resource').forEach((resource) => rememberManifestResource(resource.name));
  const entry = observedManifestUrls.slice().reverse().find((name) => isCurrentManifestUrl(name, identity));
  return entry ?? null;
}

function emit(message: Readonly<Record<string, unknown>>): void {
  updateBridgeDebug('emit', {messageType: message.type});
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

function candidatesFingerprint(candidates: ReadonlyArray<MainBridgeCandidate>): string {
  return candidates.map((candidate) => `${candidate.source}:${candidate.id}:${candidate.baseUrl}`).join('|');
}

function isCurrentManifest(manifest: MainBridgeManifest): boolean {
  return manifest.routeKey === pageRouteKey() && mediaKey(manifest.identity) === mediaKey(pageState());
}

function publishManifest(manifest: MainBridgeManifest, force = false): void {
  if (!isCurrentManifest(manifest)) return;
  const fingerprint = `${mediaKey(manifest.identity)}|${candidatesFingerprint(manifest.candidates)}`;
  if (!force && fingerprint === lastPageManifestFingerprint) return;
  lastPageManifestFingerprint = fingerprint;
  knownMediaUrls.clear();
  if (manifest.candidates.length === 0) {
    emitUnavailable('JOC stream unavailable for the current Bilibili session');
    return;
  }
  manifest.candidates.forEach((candidate) => {
    knownMediaUrls.add(candidate.baseUrl);
    candidate.backupUrls.forEach((url) => knownMediaUrls.add(url));
  });
  emit({source: BRIDGE_SOURCE, type: 'manifest', pageOrigin: PAGE_ORIGIN, pageUrl: location.href, mediaKey: manifest.identity, candidates: manifest.candidates});
}

function emitUnavailable(reason: string): void {
  knownMediaUrls.clear();
  emit({source: BRIDGE_SOURCE, type: 'unavailable', pageOrigin: PAGE_ORIGIN, pageUrl: location.href, reason});
}

function currentBootstrap(identity: MainBridgePageState): MainBridgeManifest | null {
  // __playinfo__ has no reliable identity and can survive SPA navigation unchanged.
  // Capture only the original document's bootstrap, never relabel it for another item.
  if (pageRouteKey() !== initialRouteKey) return null;
  if (bootstrapManifest === null) {
    if (!canCaptureBootstrap) return null;
    const payload = pagePlayinfo();
    const data = record(property(record(payload), 'data'));
    if (record(property(data, 'dash')) === null && record(property(data, 'dolby')) === null) return null;
    const candidates = candidatesFromPayload(payload);
    bootstrapManifest = {identity, routeKey: initialRouteKey, candidates};
    if (candidates.length > 0) initialEmbeddedFingerprint = candidatesFingerprint(candidates);
  }
  return isCurrentManifest(bootstrapManifest) ? bootstrapManifest : null;
}

function currentEmbeddedManifest(identity: MainBridgePageState, routeKey: string): MainBridgeManifest | null {
  if (routeKey === initialRouteKey || canCaptureBootstrap || initialEmbeddedFingerprint === null) return null;
  const candidates = candidatesFromPayload(pagePlayinfo());
  if (candidates.length === 0 || candidatesFingerprint(candidates) === initialEmbeddedFingerprint) return null;
  return {identity, routeKey, candidates};
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

function isCurrentManifestUrl(value: string, identity: MainBridgePageState): boolean {
  try {
    const url = new URL(value);
    const bvid = url.searchParams.get('bvid');
    const aid = url.searchParams.get('avid') ?? url.searchParams.get('aid');
    return isManifestResourceUrl(value)
      && url.searchParams.get('cid') === identity.cid
      && (bvid === null || bvid === identity.bvid)
      && (aid === null || aid === identity.aid);
  } catch {
    return false;
  }
}

function isAllowedMediaRangeMessage(value: Record<string, unknown>): boolean {
  if (resolvedManifest === null || !isCurrentManifest(resolvedManifest)) return false;
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

async function fetchManifest(url: string, identity: MainBridgePageState): Promise<void> {
  if (pendingManifest?.url === url || !isCurrentManifestUrl(url, identity)) return;
  pendingManifest?.abort.abort();
  const request = {url, abort: new AbortController()};
  const routeKey = pageRouteKey();
  pendingManifest = request;
  updateBridgeDebug('manifest-requested', {url, identity: mediaKey(identity), requestRouteKey: routeKey});
  const isCurrentRequest = (): boolean => pendingManifest === request && !request.abort.signal.aborted
    && routeKey === pageRouteKey() && mediaKey(identity) === mediaKey(pageState());
  try {
    const response = await fetch(url, {credentials: 'include', signal: request.abort.signal});
    if (!response.ok) throw new Error(`playback manifest returned status ${response.status}`);
    const payload: unknown = await response.json();
    if (!isCurrentRequest()) return;
    // A successful AAC-only response is authoritative; never fall back to old JOC globals.
    resolvedManifest = {identity, routeKey, candidates: candidatesFromPayload(payload)};
    updateBridgeDebug('manifest-response', {url, identity: mediaKey(identity), candidateCount: resolvedManifest.candidates.length});
    if (canCaptureBootstrap && routeKey === initialRouteKey && bootstrapManifest === null) bootstrapManifest = resolvedManifest;
    publishManifest(resolvedManifest, true);
  } catch (error: unknown) {
    if (!isCurrentRequest()) return;
    updateBridgeDebug('manifest-error', {url, identity: mediaKey(identity), reason: error instanceof Error ? error.message : String(error)});
    const fallback = resolvedManifest ?? currentBootstrap(identity);
    if (fallback !== null && isCurrentManifest(fallback)) {
      resolvedManifest = fallback;
      publishManifest(fallback, true);
    } else emitUnavailable(error instanceof Error ? error.message : 'failed to read the current Bilibili playback manifest');
  } finally {
    if (pendingManifest === request) pendingManifest = null;
  }
}

function scan(force = false): void {
  const routeKey = pageRouteKey();
  const identity = pageState();
  const identityKey = mediaKey(identity);
  if (routeKey !== observedRouteKey || identityKey !== observedMediaKey) {
    const previousRouteKey = observedRouteKey;
    const previousMediaKey = observedMediaKey;
    const hadMedia = previousMediaKey !== null || routeKey !== previousRouteKey;
    if (hadMedia) canCaptureBootstrap = false;
    observedRouteKey = routeKey;
    observedMediaKey = identityKey;
    pendingManifest?.abort.abort();
    pendingManifest = null;
    resolvedManifest = null;
    lastManifestUrl = null;
    lastPageManifestFingerprint = null;
    knownMediaUrls.clear();
    updateBridgeDebug('media-identity-changed', {previousRouteKey, previousMediaKey, nextRouteKey: routeKey, nextMediaKey: identityKey});
    if (hadMedia) emitUnavailable('waiting for the current Bilibili media identity');
  }
  if (identity === null) {
    updateBridgeDebug('scan-without-identity', {force});
    return;
  }
  const bootstrap = currentBootstrap(identity);
  const next = manifestUrl(identity);
  if (next !== null && (force || next !== lastManifestUrl)) {
    lastManifestUrl = next;
    updateBridgeDebug('scan-found-playurl', {force, url: next, identity: identityKey});
    void fetchManifest(next, identity);
    return;
  }
  if (pendingManifest !== null) {
    updateBridgeDebug('scan-awaiting-manifest', {force});
    return;
  }
  const manifest = resolvedManifest ?? bootstrap ?? currentEmbeddedManifest(identity, routeKey);
  if (manifest !== null) {
    resolvedManifest = manifest;
    publishManifest(manifest, force);
  }
  updateBridgeDebug('scan', {force});
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
      const response = await fetch(url, {credentials: 'omit', headers: {Range: `bytes=${start}-${end}`}, referrer: location.href, referrerPolicy: 'no-referrer-when-downgrade'});
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

observeManifestResources();
window.setInterval((): void => scan(), 1_000);
scan();
})();
