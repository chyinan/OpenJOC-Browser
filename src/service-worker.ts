// pattern: Imperative Shell

import {isLegacyOffscreenStatus, isRuntimeMessage, type BilibiliAudioCandidate, type MediaKey, type RendererMode, type RuntimeMessage} from './extension-protocol.js';
import {isAllowedBilibiliMediaUrl} from './media-url-policy.js';
import {DEFAULT_HRTF_PRESET, normalizeHrtfSelection, type HrtfSelection} from './hrtf-presets.js';
import {clearRetiredHrtfAssetCache, HRTF_ASSET_CACHE_NAME} from './hrtf-assets.js';
import {abortCustomSofaImport, beginCustomSofaImport, commitCustomSofaImport, discardCustomSofaAsset, loadCustomSofaAsset, writeCustomSofaImportChunk} from './custom-sofa-storage.js';
import {isValidCustomSofaBase64} from './custom-sofa-transfer.js';
import {loadOpenJocWasm} from './wasm-bindings.js';
import {isContentSessionReset, isStaleContentGeneration, mediaSessionRestartRequired, nextManifestGeneration, type MediaSessionSnapshot} from './media-session-policy.js';

type BilibiliSession = {
  readonly tabId: number;
  readonly documentId: string | null;
  readonly requestId: string;
  readonly pageUrl: string;
  readonly mediaKey: MediaKey;
  readonly candidate: BilibiliAudioCandidate;
  readonly generation: number;
  readonly videoTimeSamples: number;
  readonly paused: boolean;
  readonly buffering: boolean;
  readonly dialnorm: 'calibrated' | 'unity';
  readonly renderer: RendererMode;
  readonly hrtf: HrtfSelection;
  readonly hrtfRevision: string | null;
  readonly gainDb: number;
  readonly started: boolean;
};

type PendingHrtfSwitch = Readonly<{
  readonly fallback: BilibiliSession;
  readonly requestId: string;
  readonly generation: number;
  readonly requestedHrtf: HrtfSelection;
  readonly requestedHrtfRevision: string | null;
}>;

type PendingPageRange = Readonly<{
  readonly tabId: number;
  readonly generation: number;
  readonly url: string;
  readonly start: number;
  readonly end: number;
}>;

type CustomSofaTransferRequest = Extract<RuntimeMessage, {
  readonly type: 'custom-sofa-query' | 'custom-sofa-import-start' | 'custom-sofa-import-chunk' | 'custom-sofa-import-commit' | 'custom-sofa-import-abort';
}>;

type CustomSofaTransferReply = Readonly<{
  readonly ok: boolean;
  readonly available?: boolean;
  readonly byteLength?: number;
  readonly sha256?: string;
  readonly error?: string;
}>;

const OFFSCREEN_PATH = 'offscreen.html';
const sessions = new Map<number, BilibiliSession>();
const pendingHrtfSwitches = new Map<number, PendingHrtfSwitch>();
const activeDocumentIds = new Map<number, string>();
const pendingPageRanges = new Map<string, PendingPageRange>();
const lifecycleTails = new Map<number, Promise<void>>();
const clockTails = new Map<number, Promise<void>>();
const legacyRecoveryTabs = new Set<number>();
let offscreenCreation: Promise<void> | null = null;
let offscreenRecreation: Promise<void> | null = null;
let customSofaCommitTail: Promise<void> = Promise.resolve();

function isBilibiliVideoPage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === 'https://www.bilibili.com' && url.pathname.startsWith('/video/');
  } catch {
    return false;
  }
}

function approvedCandidate(pageUrl: string, candidates: ReadonlyArray<BilibiliAudioCandidate>): BilibiliAudioCandidate | null {
  const ordered = [...candidates].sort((left) => left.source === 'dolby' ? -1 : 1);
  return ordered.find((candidate) => isAllowedBilibiliMediaUrl(candidate.baseUrl, pageUrl) && candidate.backupUrls.every((url) => isAllowedBilibiliMediaUrl(url, pageUrl))) ?? null;
}

async function ensureOffscreenDocument(startingRequestId?: string): Promise<void> {
  const observedSessions = [...sessions.values()];
  const getContexts = chrome.runtime.getContexts;
  if (getContexts !== undefined) {
    const contexts = await getContexts({contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]});
    if (contexts.length > 0) return;
  }
  if (offscreenCreation !== null) {
    await offscreenCreation;
    return;
  }
  invalidateObservedSessions(observedSessions, startingRequestId);
  offscreenCreation = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Decode the currently selected Bilibili JOC representation through OpenJOC WASM and play timestamped Stereo PCM.',
  });
  try {
    await offscreenCreation;
  } finally {
    offscreenCreation = null;
  }
}

async function recreateOffscreenDocument(): Promise<void> {
  if (offscreenRecreation !== null) {
    await offscreenRecreation;
    return;
  }
  offscreenRecreation = (async(): Promise<void> => {
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      // The stale document may already have closed between detection and recovery.
    }
    offscreenCreation = null;
    await ensureOffscreenDocument();
  })();
  try {
    await offscreenRecreation;
  } finally {
    offscreenRecreation = null;
  }
}

function recoverLegacyOffscreen(tabId: number): void {
  if (legacyRecoveryTabs.has(tabId)) return;
  legacyRecoveryTabs.add(tabId);
  void recreateOffscreenDocument()
    .then((): void => requestSessionFromContent(tabId, {target: 'background', type: 'request-session', force: true}))
    .catch(() => undefined)
    .finally((): void => {
      legacyRecoveryTabs.delete(tabId);
    });
}

async function sendToOffscreen(message: RuntimeMessage): Promise<void> {
  if (message.type === 'start') {
    await ensureOffscreenDocument(message.requestId);
  } else if (!await hasLiveOffscreenDocument()) {
    // A clock cannot initialize a document reclaimed after AUDIO_PLAYBACK silence.
    // Let the request-aware heartbeat rebuild from the page's current position.
    return;
  }
  await chrome.runtime.sendMessage(message);
}

async function hasLiveOffscreenDocument(): Promise<boolean> {
  if (chrome.runtime.getContexts === undefined) return true;
  const observedSessions = [...sessions.values()];
  const contexts = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]});
  if (contexts.length > 0 || offscreenCreation !== null) return true;
  invalidateObservedSessions(observedSessions);
  return false;
}

function invalidateObservedSessions(observedSessions: ReadonlyArray<BilibiliSession>, startingRequestId?: string): void {
  for (const observed of observedSessions) {
    const current = sessions.get(observed.tabId);
    if (current?.started && current.requestId === observed.requestId && current.generation === observed.generation
      && current.requestId !== startingRequestId) {
      sessions.set(observed.tabId, {...current, started: false});
    }
  }
}

async function sendSessionStart(session: BilibiliSession): Promise<void> {
  try {
    await sendToOffscreen({target: 'offscreen', type: 'start', requestId: session.requestId, tabId: session.tabId, pageUrl: session.pageUrl, mediaKey: session.mediaKey, candidate: session.candidate, generation: session.generation, videoTimeSamples: session.videoTimeSamples, paused: session.paused, buffering: session.buffering, dialnorm: session.dialnorm, renderer: session.renderer, hrtf: session.hrtf, hrtfRevision: session.hrtfRevision, gainDb: session.gainDb});
  } catch (error: unknown) {
    const current = sessions.get(session.tabId);
    if (current?.requestId === session.requestId && current.generation === session.generation) {
      sessions.set(session.tabId, {...current, started: false});
    }
    throw error;
  }
}

function tabIdFromSender(sender: ChromeMessageSender): number | null {
  const tabId = sender.tab?.id;
  return tabId !== undefined && Number.isSafeInteger(tabId) && tabId > 0 ? tabId : null;
}

function requestSessionFromContent(tabId: number, message: Extract<RuntimeMessage, {type: 'request-session'}>): void {
  void chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
}

async function handleContentMessage(message: RuntimeMessage, tabId: number, documentId: string | null): Promise<void> {
  if (message.target !== 'background') return;
  if (message.type === 'document-active') {
    if (documentId !== null) {
      activeDocumentIds.set(tabId, documentId);
      const previous = sessions.get(tabId);
      if (previous !== undefined && previous.documentId !== documentId) {
        sessions.delete(tabId);
        pendingHrtfSwitches.delete(tabId);
        if (previous.started) await sendToOffscreen({target: 'offscreen', type: 'disable', tabId, mediaKey: previous.mediaKey, generation: previous.generation});
      }
    }
    return;
  }
  const activeDocumentId = activeDocumentIds.get(tabId);
  if (documentId !== null && activeDocumentId !== undefined && documentId !== activeDocumentId) return;
  const owner = sessions.get(tabId);
  if (message.type !== 'start' && message.type !== 'manifest' && owner !== undefined
    && documentId !== null && owner.documentId !== null && documentId !== owner.documentId) return;
  switch (message.type) {
    case 'request-session':
      return;
    case 'start': {
      if (!isBilibiliVideoPage(message.pageUrl)) return;
      const candidate = approvedCandidate(message.pageUrl, message.candidates);
      if (candidate === null) return;
      const previous = sessions.get(tabId);
      const previousSnapshot: MediaSessionSnapshot | null = previous === undefined ? null : {
        mediaKey: mediaKeyString(previous.mediaKey),
        candidateUrl: previous.candidate.baseUrl,
        generation: previous.generation,
        started: previous.started,
      };
      const isReloadRecovery = previous !== undefined && documentId !== null && previous.documentId !== null
        ? documentId !== previous.documentId
        : isContentSessionReset(previousSnapshot, mediaKeyString(message.mediaKey), message.generation);
      if (isReloadRecovery) {
        sessions.delete(tabId);
        pendingHrtfSwitches.delete(tabId);
        if (previous?.started === true) await sendToOffscreen({target: 'offscreen', type: 'disable', tabId, mediaKey: previous.mediaKey, generation: previous.generation});
      }
      const baseline = isReloadRecovery ? undefined : previous;
      if (isStaleContentGeneration(isReloadRecovery ? null : previousSnapshot, message.generation)) return;
      const generation = Math.max(message.generation, baseline?.started === true ? baseline.generation + 1 : baseline?.generation ?? 0);
      const selectedHrtf = normalizeHrtfSelection(message.hrtf);
      const selectedHrtfRevision = selectedHrtf === 'custom-sofa' ? message.hrtfRevision ?? null : null;
      const next = {tabId, documentId, requestId: message.requestId, pageUrl: message.pageUrl, mediaKey: message.mediaKey, candidate, generation, videoTimeSamples: message.videoTimeSamples, paused: message.paused ?? false, buffering: message.buffering ?? false, dialnorm: message.dialnorm, renderer: message.renderer, hrtf: selectedHrtf, hrtfRevision: selectedHrtfRevision, gainDb: message.gainDb ?? 0, started: true};
      const priorSwitch = pendingHrtfSwitches.get(tabId);
      const fallback = priorSwitch?.fallback ?? baseline;
      const isHrtfOnlySwitch = previous?.started === true
        && !isReloadRecovery
        && previous.renderer === 'binaural'
        && next.renderer === 'binaural'
        && (previous.hrtf !== selectedHrtf || previous.hrtfRevision !== selectedHrtfRevision)
        && fallback?.renderer === 'binaural'
        && mediaKeyEquals(fallback.mediaKey, next.mediaKey)
        && fallback.candidate.baseUrl === next.candidate.baseUrl
        && fallback.documentId === next.documentId;
      if (isHrtfOnlySwitch && fallback !== undefined) {
        pendingHrtfSwitches.set(tabId, {
          fallback,
          requestId: next.requestId,
          generation: next.generation,
          requestedHrtf: selectedHrtf,
          requestedHrtfRevision: selectedHrtfRevision,
        });
      } else {
        pendingHrtfSwitches.delete(tabId);
      }
      sessions.set(tabId, next);
      await sendSessionStart(next);
      return;
    }
    case 'manifest': {
      if (!isBilibiliVideoPage(message.pageUrl)) return;
      const candidate = approvedCandidate(message.pageUrl, message.candidates);
      if (candidate === null) return;
      const previous = sessions.get(tabId);
      const previousSnapshot: MediaSessionSnapshot | null = previous === undefined ? null : {
        mediaKey: mediaKeyString(previous.mediaKey),
        candidateUrl: previous.candidate.baseUrl,
        generation: previous.generation,
        started: previous.started,
      };
      const isReloadRecovery = previous !== undefined && documentId !== null && previous.documentId !== null
        ? documentId !== previous.documentId
        : isContentSessionReset(previousSnapshot, mediaKeyString(message.mediaKey), message.generation);
      if (isReloadRecovery) {
        sessions.delete(tabId);
        pendingHrtfSwitches.delete(tabId);
        if (previous?.started === true) await sendToOffscreen({target: 'offscreen', type: 'disable', tabId, mediaKey: previous.mediaKey, generation: previous.generation});
      }
      const baseline = isReloadRecovery ? undefined : previous;
      const baselineSnapshot = isReloadRecovery ? null : previousSnapshot;
      const nextSnapshot: MediaSessionSnapshot = {
        mediaKey: mediaKeyString(message.mediaKey),
        candidateUrl: candidate.baseUrl,
        generation: message.generation,
        started: baseline?.started ?? false,
      };
      if (isStaleContentGeneration(baselineSnapshot, message.generation)) return;
      const hasSessionChanged = mediaSessionRestartRequired(baselineSnapshot, nextSnapshot);
      if (hasSessionChanged) pendingHrtfSwitches.delete(tabId);
      const generation = Math.max(message.generation, nextManifestGeneration(baselineSnapshot, nextSnapshot));
      const next = {tabId, documentId, requestId: baseline?.requestId ?? crypto.randomUUID(), pageUrl: message.pageUrl, mediaKey: message.mediaKey, candidate, generation, videoTimeSamples: baseline?.videoTimeSamples ?? 0, paused: baseline?.paused ?? false, buffering: baseline?.buffering ?? false, dialnorm: baseline?.dialnorm ?? 'calibrated', renderer: baseline?.renderer ?? 'stereo', hrtf: baseline?.hrtf ?? DEFAULT_HRTF_PRESET, hrtfRevision: baseline?.hrtfRevision ?? null, gainDb: baseline?.gainDb ?? 0, started: baseline?.started ?? false};
      sessions.set(tabId, next);
      if (baseline?.started === true && hasSessionChanged) await sendSessionStart(next);
      return;
    }
    case 'toggle': {
      const session = sessions.get(tabId);
      if (session === undefined) return;
      if (session.started) {
        pendingHrtfSwitches.delete(tabId);
        await sendToOffscreen({target: 'offscreen', type: 'disable', tabId, mediaKey: session.mediaKey, generation: session.generation});
        sessions.set(tabId, {...session, started: false});
        return;
      }
      const nextSession = {...session, generation: session.generation + 1, started: true};
      sessions.set(tabId, nextSession);
      await sendSessionStart(nextSession);
      return;
    }
    case 'session-heartbeat': {
      await hasLiveOffscreenDocument();
      const session = sessions.get(tabId);
      // Receipt of this exact request is distinct from the decoder's eventual acknowledgement.
      if (session === undefined || !session.started || session.requestId !== message.requestId || !mediaKeyEquals(message.mediaKey, session.mediaKey)) {
        requestSessionFromContent(tabId, {
          target: 'background', type: 'request-session', force: true, requestId: message.requestId,
          generation: Math.max(message.generation, session?.generation ?? 0),
        });
      }
      return;
    }
    case 'video-clock': {
      const session = sessions.get(tabId);
      if (session === undefined || !session.started || message.requestId !== session.requestId || message.generation < session.generation || mediaKeyEquals(message.mediaKey, session.mediaKey) === false) return;
      if (message.generation > session.generation) {
        const restarted = {...session, generation: message.generation, videoTimeSamples: message.mediaTimeSamples};
        sessions.set(tabId, restarted);
        await sendSessionStart(restarted);
        return;
      }
      await sendToOffscreen({target: 'offscreen', type: 'clock', tabId, generation: message.generation, mediaTimeSamples: message.mediaTimeSamples, paused: message.paused, buffering: message.buffering, playbackRate: message.playbackRate, expectedDisplayTimeMs: message.expectedDisplayTimeMs});
      const current = sessions.get(tabId);
      if (current === undefined || !current.started || current.requestId !== session.requestId || current.generation !== session.generation || mediaKeyEquals(current.mediaKey, session.mediaKey) === false) return;
      sessions.set(tabId, {...current, videoTimeSamples: message.mediaTimeSamples});
      return;
    }
    case 'native-muted': {
      const session = sessions.get(tabId);
      if (session?.started === true && message.generation === session.generation) await sendToOffscreen({target: 'offscreen', type: 'native-muted', tabId, generation: message.generation});
      return;
    }
    case 'player-volume': {
      const session = sessions.get(tabId);
      if (session?.started !== true || session.requestId !== message.requestId || session.generation !== message.generation) return;
      await sendToOffscreen({...message, target: 'offscreen', tabId});
      return;
    }
    case 'disable': {
      const session = sessions.get(tabId);
      if (session === undefined || !mediaKeyEquals(message.mediaKey, session.mediaKey) || message.generation < session.generation) return;
      pendingHrtfSwitches.delete(tabId);
      const nextGeneration = Math.max(message.generation, session.generation);
      if (session.started === true) await sendToOffscreen({target: 'offscreen', type: 'disable', tabId, mediaKey: session.mediaKey, generation: session.generation});
      sessions.set(tabId, {...session, started: false, generation: nextGeneration});
      return;
    }
    case 'page-media-range-response': {
      const session = sessions.get(tabId);
      const pending = pendingPageRanges.get(message.requestId);
      if (session === undefined || pending === undefined || pending.tabId !== tabId || pending.generation !== message.generation || message.generation !== session.generation || base64ByteLength(message.bufferBase64) > pending.end - pending.start + 1) return;
      pendingPageRanges.delete(message.requestId);
      await sendToOffscreen({target: 'offscreen', type: 'page-media-range-response', tabId, generation: message.generation, requestId: message.requestId, status: message.status, contentRange: message.contentRange, error: message.error, bufferBase64: message.bufferBase64});
      return;
    }
    case 'dialnorm': {
      const session = sessions.get(tabId);
      if (session === undefined) return;
      const nextGeneration = session.started ? Math.max(session.generation + 1, message.generation + 1) : session.generation;
      const nextSession = {...session, dialnorm: message.mode, generation: nextGeneration};
      sessions.set(tabId, nextSession);
      if (session.started) await sendSessionStart(nextSession);
      return;
    }
    case 'output-gain': {
      const session = sessions.get(tabId);
      if (session === undefined || session.requestId !== message.requestId) return;
      sessions.set(tabId, {...session, gainDb: message.gainDb});
      if (session.started) await sendToOffscreen({target: 'offscreen', type: 'output-gain', tabId, requestId: session.requestId, generation: session.generation, gainDb: message.gainDb});
      return;
    }
    case 'request-manifest':
    case 'offscreen-status':
      return;
  }
}

type LifecycleContentMessage = Extract<RuntimeMessage, {target: 'background'; type: 'document-active' | 'start' | 'manifest' | 'toggle' | 'disable' | 'dialnorm' | 'session-heartbeat' | 'output-gain' | 'player-volume'}>;

function isLifecycleContentMessage(message: RuntimeMessage): message is LifecycleContentMessage {
  return message.type === 'document-active' || message.type === 'start' || message.type === 'manifest' || message.type === 'toggle'
    || message.type === 'disable' || message.type === 'dialnorm' || message.type === 'session-heartbeat' || message.type === 'output-gain' || message.type === 'player-volume';
}

function enqueueLifecycleOperation(tabId: number, operation: () => Promise<void>): void {
  const previousTail = lifecycleTails.get(tabId) ?? Promise.resolve();
  const nextTail = previousTail
    .catch(() => undefined)
    .then(operation)
    .catch(() => undefined)
    .finally((): void => {
      if (lifecycleTails.get(tabId) === nextTail) lifecycleTails.delete(tabId);
    });
  lifecycleTails.set(tabId, nextTail);
}

function enqueueLifecycleMessage(message: LifecycleContentMessage, tabId: number, documentId: string | null): void {
  enqueueLifecycleOperation(tabId, () => handleContentMessage(message, tabId, documentId));
}

function enqueueClockMessage(message: Extract<RuntimeMessage, {target: 'background'; type: 'video-clock'}>, tabId: number, documentId: string | null): void {
  const lifecycleBarrier = lifecycleTails.get(tabId) ?? Promise.resolve();
  const previousTail = clockTails.get(tabId) ?? Promise.resolve();
  const nextTail = previousTail
    .catch(() => undefined)
    .then(async(): Promise<void> => {
      await lifecycleBarrier.catch(() => undefined);
      await handleContentMessage(message, tabId, documentId);
    })
    .catch(() => undefined)
    .finally((): void => {
      if (clockTails.get(tabId) === nextTail) clockTails.delete(tabId);
    });
  clockTails.set(tabId, nextTail);
}

async function handleOffscreenRangeRequest(message: Extract<RuntimeMessage, {target: 'background'; type: 'page-media-range-request'}>): Promise<void> {
  const session = sessions.get(message.tabId);
  if (session === undefined || !session.started || message.generation !== session.generation) return;
  if (message.end - message.start + 1 > 4 * 1024 * 1024 || !isAllowedBilibiliMediaUrl(message.url, session.pageUrl) || !candidateUrls(session.candidate).includes(message.url)) return;
  pendingPageRanges.set(message.requestId, {tabId: message.tabId, generation: message.generation, url: message.url, start: message.start, end: message.end});
  try {
    await chrome.tabs.sendMessage(message.tabId, message);
  } catch (error: unknown) {
    pendingPageRanges.delete(message.requestId);
    throw error;
  }
}

function candidateUrls(candidate: BilibiliAudioCandidate): ReadonlyArray<string> {
  return [candidate.baseUrl, ...candidate.backupUrls];
}

function mediaKeyEquals(left: MediaKey, right: MediaKey): boolean {
  return left.bvid === right.bvid && left.aid === right.aid && left.cid === right.cid;
}

function mediaKeyString(key: MediaKey): string {
  return `${key.bvid}:${key.aid}:${key.cid}`;
}

function base64ByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

chrome.action.onClicked.addListener((tab: ChromeTab): void => {
  if (tab.id === undefined) return;
  void chrome.tabs.sendMessage(tab.id, {target: 'background', type: 'toggle'}).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((rawMessage: unknown, sender: ChromeMessageSender): void => {
  if (sender.id === chrome.runtime.id && isLegacyOffscreenStatus(rawMessage)) recoverLegacyOffscreen(rawMessage.tabId);
});

chrome.runtime.onMessage.addListener((
  rawMessage: unknown,
  sender: ChromeMessageSender,
  sendResponse: (response: unknown) => void,
): boolean | void => {
  if (!isRuntimeMessage(rawMessage)
    || rawMessage.target !== 'background'
    || !isCustomSofaTransferRequest(rawMessage)) return;
  if (sender.id !== chrome.runtime.id || tabIdFromSender(sender) === null) {
    sendResponse({ok: false, error: 'custom SOFA import must come from an OpenJOC tab'} satisfies CustomSofaTransferReply);
    return;
  }
  void handleCustomSofaTransfer(rawMessage)
    .then((reply) => sendResponse(reply))
    .catch((error: unknown) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'failed to store Custom SOFA data',
    } satisfies CustomSofaTransferReply));
  return true;
});

async function handleCustomSofaTransfer(message: CustomSofaTransferRequest): Promise<CustomSofaTransferReply> {
  switch (message.type) {
    case 'custom-sofa-query': {
      const asset = await loadCustomSofaAsset(message.revision ?? null);
      return asset === null
        ? {ok: true, available: false}
        : {ok: true, available: true, sha256: asset.sha256};
    }
    case 'custom-sofa-import-start':
      await chrome.storage.local.set({hrtfSelectionGeneration: message.transferId});
      await beginCustomSofaImport(message.transferId, message.byteLength, message.preserveSha256 ?? null);
      return {ok: true};
    case 'custom-sofa-import-chunk': {
      if (!isValidCustomSofaBase64(message.bytesBase64)) throw new Error('invalid Custom SOFA chunk encoding');
      const encoded = atob(message.bytesBase64);
      const bytes = new Uint8Array(encoded.length);
      for (let index = 0; index < encoded.length; index += 1) bytes[index] = encoded.charCodeAt(index);
      await writeCustomSofaImportChunk(message.transferId, message.index, bytes);
      return {ok: true};
    }
    case 'custom-sofa-import-commit': {
      return enqueueCustomSofaCommit(async(): Promise<CustomSofaTransferReply> => {
        const selectionBefore = await chrome.storage.local.get(['hrtfPreset', 'hrtfRevision', 'hrtfSelectionGeneration']);
        const stored = await chrome.storage.local.get(['hrtfRevision', 'customSofaLastRevision']);
        const preserveSha256 = [stored.hrtfRevision, stored.customSofaLastRevision]
          .find((revision): revision is string => typeof revision === 'string' && /^[0-9a-f]{64}$/.test(revision)) ?? null;
        const asset = await commitCustomSofaImport(message.transferId, preserveSha256);
        if (message.prevalidate === true) {
          try {
            const decoder = await loadOpenJocWasm(
              new URL(chrome.runtime.getURL('wasm/openjoc_wasm.wasm')),
              {renderer: 'binaural', hrtf: 'custom-sofa', hrtfRevision: asset.sha256},
            );
            decoder.destroy();
          } catch (error: unknown) {
            if (asset.created) await discardCustomSofaAsset(asset.sha256, asset.revision);
            throw new Error('Custom SOFA is not compatible with the fixed 7.1.4 binaural renderer', {cause: error});
          }
        }
        const selectionAfter = await chrome.storage.local.get(['hrtfPreset', 'hrtfRevision', 'hrtfSelectionGeneration']);
        const selectionIsCurrent = selectionBefore.hrtfSelectionGeneration === message.transferId
          && selectionAfter.hrtfSelectionGeneration === message.transferId
          && selectionAfter.hrtfPreset === selectionBefore.hrtfPreset
          && selectionAfter.hrtfRevision === selectionBefore.hrtfRevision;
        if (selectionIsCurrent) {
          await chrome.storage.local.set({
            hrtfPreset: 'custom-sofa',
            hrtfRevision: asset.sha256,
            customSofaLastRevision: asset.sha256,
            hrtfSelectionGeneration: message.transferId,
          });
        }
        return {ok: true, byteLength: asset.byteLength, sha256: asset.sha256};
      });
    }
    case 'custom-sofa-import-abort':
      await abortCustomSofaImport(message.transferId);
      return {ok: true};
  }
}

function enqueueCustomSofaCommit(operation: () => Promise<CustomSofaTransferReply>): Promise<CustomSofaTransferReply> {
  const queued = customSofaCommitTail.then(operation);
  customSofaCommitTail = queued.then(() => undefined, () => undefined);
  return queued;
}

function isCustomSofaTransferRequest(message: RuntimeMessage): message is CustomSofaTransferRequest {
  return message.target === 'background'
    && (message.type === 'custom-sofa-query'
      || message.type === 'custom-sofa-import-start'
      || message.type === 'custom-sofa-import-chunk'
      || message.type === 'custom-sofa-import-commit'
      || message.type === 'custom-sofa-import-abort');
}

chrome.runtime.onInstalled.addListener((details: ChromeInstalledDetails): void => {
  if (details.reason === 'install' || details.reason === 'update') requestRetiredHrtfCachePurge();
});

chrome.runtime.onStartup.addListener(requestRetiredHrtfCachePurge);
requestRetiredHrtfCachePurge();

function requestRetiredHrtfCachePurge(): void {
  void purgeRetiredHrtfCacheEntries().catch((error: unknown) => {
    console.warn('failed to remove obsolete HRTF cache; will retry on the next extension lifecycle event', error);
  });
}

async function purgeRetiredHrtfCacheEntries(): Promise<void> {
  if (typeof globalThis.caches === 'undefined') return;
  const cacheNames = await globalThis.caches.keys();
  if (!cacheNames.includes(HRTF_ASSET_CACHE_NAME)) return;
  const cache = await globalThis.caches.open(HRTF_ASSET_CACHE_NAME);
  await clearRetiredHrtfAssetCache(cache);
}

chrome.runtime.onMessage.addListener((rawMessage: unknown, sender: ChromeMessageSender): void => {
  if (!isRuntimeMessage(rawMessage)) return;
  if (rawMessage.target === 'background') {
    const senderTabId = tabIdFromSender(sender);
    if (senderTabId !== null) {
      if (rawMessage.type === 'video-clock') enqueueClockMessage(rawMessage, senderTabId, sender.documentId ?? null);
      else if (isLifecycleContentMessage(rawMessage)) enqueueLifecycleMessage(rawMessage, senderTabId, sender.documentId ?? null);
      else void handleContentMessage(rawMessage, senderTabId, sender.documentId ?? null).catch(() => undefined);
    } else if (sender.id === chrome.runtime.id && rawMessage.type === 'page-media-range-request') {
      void handleOffscreenRangeRequest(rawMessage).catch(() => undefined);
    }
    return;
  }
  return;
});

chrome.runtime.onMessage.addListener((rawMessage: unknown, sender: ChromeMessageSender): void => {
  if (!isRuntimeMessage(rawMessage) || rawMessage.target !== 'background' || rawMessage.type !== 'offscreen-status' || sender.id !== chrome.runtime.id) return;
  const session = sessions.get(rawMessage.tabId);
  if (session !== undefined && rawMessage.requestId === session.requestId && mediaKeyEquals(rawMessage.mediaKey, session.mediaKey) && rawMessage.generation >= session.generation) {
    const pendingHrtfSwitch = pendingHrtfSwitches.get(rawMessage.tabId);
    if (rawMessage.phase === 'error'
      && rawMessage.reason?.toLowerCase().includes('hrtf') === true
      && pendingHrtfSwitch?.requestId === rawMessage.requestId
      && pendingHrtfSwitch.generation === session.generation
      && rawMessage.metrics.hrtf === pendingHrtfSwitch.fallback.hrtf
      && (rawMessage.metrics.hrtfRevision ?? null) === pendingHrtfSwitch.fallback.hrtfRevision) {
      pendingHrtfSwitches.delete(rawMessage.tabId);
      const restoredSession: BilibiliSession = {
        ...pendingHrtfSwitch.fallback,
        requestId: session.requestId,
        generation: rawMessage.generation + 1,
        videoTimeSamples: session.videoTimeSamples,
        paused: session.paused,
        buffering: session.buffering,
        dialnorm: session.dialnorm,
        gainDb: session.gainDb,
        started: true,
      };
      sessions.set(rawMessage.tabId, restoredSession);
      const rollbackStatus: RuntimeMessage = {
        ...rawMessage,
        generation: restoredSession.generation,
        phase: 'preparing',
        reason: `hrtf-load-error-rollback: ${rawMessage.reason}`,
        metrics: {
          ...rawMessage.metrics,
          stage: 'hrtf-load-error-rollback',
          renderer: restoredSession.renderer,
          virtualLayout: restoredSession.renderer === 'binaural' ? '7.1.4' : null,
          hrtf: restoredSession.renderer === 'binaural' ? restoredSession.hrtf : null,
          hrtfRevision: restoredSession.renderer === 'binaural' ? restoredSession.hrtfRevision : null,
        },
      };
      void chrome.tabs.sendMessage(rawMessage.tabId, rollbackStatus).catch(() => undefined);
      void sendSessionStart(restoredSession).catch(() => {
        const current = sessions.get(restoredSession.tabId);
        if (current?.requestId === restoredSession.requestId && current.generation === restoredSession.generation) {
          sessions.set(restoredSession.tabId, {...current, started: false});
        }
      });
      return;
    }
    if (pendingHrtfSwitch?.requestId === rawMessage.requestId
      && rawMessage.phase !== 'error'
      && rawMessage.metrics.hrtf === pendingHrtfSwitch.requestedHrtf
      && (rawMessage.metrics.hrtfRevision ?? null) === pendingHrtfSwitch.requestedHrtfRevision) {
      pendingHrtfSwitches.delete(rawMessage.tabId);
    }
    sessions.set(rawMessage.tabId, {...session, started: rawMessage.phase !== 'disabled' && rawMessage.phase !== 'error', generation: rawMessage.generation});
    void chrome.tabs.sendMessage(rawMessage.tabId, rawMessage).catch(() => undefined);
  }
});
