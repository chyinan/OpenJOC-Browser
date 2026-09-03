// pattern: Imperative Shell

import {isRuntimeMessage, type BilibiliAudioCandidate, type MediaKey, type RuntimeMessage} from './extension-protocol.js';
import {isAllowedBilibiliMediaUrl} from './media-url-policy.js';

type BilibiliSession = {
  readonly tabId: number;
  readonly pageUrl: string;
  readonly mediaKey: MediaKey;
  readonly candidate: BilibiliAudioCandidate;
  readonly generation: number;
  readonly videoTimeSamples: number;
  readonly dialnorm: 'calibrated' | 'unity';
  readonly started: boolean;
};

type PendingPageRange = Readonly<{
  readonly tabId: number;
  readonly generation: number;
  readonly url: string;
  readonly start: number;
  readonly end: number;
}>;

const OFFSCREEN_PATH = 'offscreen.html';
const sessions = new Map<number, BilibiliSession>();
const pendingPageRanges = new Map<string, PendingPageRange>();
let offscreenCreation: Promise<void> | null = null;

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

async function ensureOffscreenDocument(): Promise<void> {
  const getContexts = chrome.runtime.getContexts;
  if (getContexts !== undefined) {
    const contexts = await getContexts({contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]});
    if (contexts.length > 0) return;
  }
  if (offscreenCreation !== null) {
    await offscreenCreation;
    return;
  }
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

async function sendToOffscreen(message: RuntimeMessage): Promise<void> {
  await ensureOffscreenDocument();
  await chrome.runtime.sendMessage(message);
}

function tabIdFromSender(sender: ChromeMessageSender): number | null {
  const tabId = sender.tab?.id;
  return tabId !== undefined && Number.isSafeInteger(tabId) && tabId > 0 ? tabId : null;
}

function requestSessionFromContent(tabId: number): void {
  void chrome.tabs.sendMessage(tabId, {target: 'background', type: 'request-session'}).catch(() => undefined);
}

async function handleContentMessage(message: RuntimeMessage, tabId: number): Promise<void> {
  if (message.target !== 'background') return;
  switch (message.type) {
    case 'request-session':
      return;
    case 'start': {
      if (!isBilibiliVideoPage(message.pageUrl)) return;
      const candidate = approvedCandidate(message.pageUrl, message.candidates);
      if (candidate === null) return;
      const previous = sessions.get(tabId);
      const generation = Math.max(message.generation, previous?.started === true ? previous.generation + 1 : previous?.generation ?? 0);
      const next = {tabId, pageUrl: message.pageUrl, mediaKey: message.mediaKey, candidate, generation, videoTimeSamples: message.videoTimeSamples, dialnorm: message.dialnorm, started: true};
      sessions.set(tabId, next);
      await sendToOffscreen({target: 'offscreen', type: 'start', tabId, pageUrl: next.pageUrl, mediaKey: next.mediaKey, candidate: next.candidate, generation: next.generation, videoTimeSamples: next.videoTimeSamples, dialnorm: next.dialnorm});
      return;
    }
    case 'manifest': {
      if (!isBilibiliVideoPage(message.pageUrl)) return;
      const candidate = approvedCandidate(message.pageUrl, message.candidates);
      if (candidate === null) return;
      const previous = sessions.get(tabId);
      const hasCandidateChanged = previous === undefined || previous.candidate.baseUrl !== candidate.baseUrl;
      const generation = previous?.started === true && hasCandidateChanged ? previous.generation + 1 : previous?.generation ?? 0;
      const next = {tabId, pageUrl: message.pageUrl, mediaKey: message.mediaKey, candidate, generation, videoTimeSamples: previous?.videoTimeSamples ?? 0, dialnorm: previous?.dialnorm ?? 'calibrated', started: previous?.started ?? false};
      sessions.set(tabId, next);
      if (previous?.started === true && hasCandidateChanged) await sendToOffscreen({target: 'offscreen', type: 'start', tabId, pageUrl: next.pageUrl, mediaKey: next.mediaKey, candidate: next.candidate, generation: next.generation, videoTimeSamples: next.videoTimeSamples, dialnorm: next.dialnorm});
      return;
    }
    case 'toggle': {
      const session = sessions.get(tabId);
      if (session === undefined) return;
      if (session.started) {
        await sendToOffscreen({target: 'offscreen', type: 'disable', tabId, generation: session.generation});
        sessions.set(tabId, {...session, started: false});
        return;
      }
      await sendToOffscreen({target: 'offscreen', type: 'start', tabId, pageUrl: session.pageUrl, mediaKey: session.mediaKey, candidate: session.candidate, generation: session.generation + 1, videoTimeSamples: session.videoTimeSamples, dialnorm: session.dialnorm});
      sessions.set(tabId, {...session, generation: session.generation + 1, started: true});
      return;
    }
    case 'session-heartbeat': {
      const session = sessions.get(tabId);
      if (session === undefined || !session.started || session.generation !== message.generation || session.pageUrl !== message.pageUrl || mediaKeyEquals(message.mediaKey, session.mediaKey) === false) {
        requestSessionFromContent(tabId);
      }
      return;
    }
    case 'video-clock': {
      const session = sessions.get(tabId);
      if (session === undefined || !session.started || message.generation < session.generation || mediaKeyEquals(message.mediaKey, session.mediaKey) === false) return;
      if (message.generation > session.generation) {
        const restarted = {...session, generation: message.generation, videoTimeSamples: message.mediaTimeSamples};
        sessions.set(tabId, restarted);
        await sendToOffscreen({target: 'offscreen', type: 'start', tabId, pageUrl: restarted.pageUrl, mediaKey: restarted.mediaKey, candidate: restarted.candidate, generation: restarted.generation, videoTimeSamples: restarted.videoTimeSamples, dialnorm: restarted.dialnorm});
        return;
      }
      sessions.set(tabId, {...session, videoTimeSamples: message.mediaTimeSamples});
      await sendToOffscreen({target: 'offscreen', type: 'clock', tabId, generation: message.generation, mediaTimeSamples: message.mediaTimeSamples, paused: message.paused, buffering: message.buffering, playbackRate: message.playbackRate, expectedDisplayTimeMs: message.expectedDisplayTimeMs});
      return;
    }
    case 'native-muted': {
      const session = sessions.get(tabId);
      if (session?.started === true && message.generation === session.generation) await sendToOffscreen({target: 'offscreen', type: 'native-muted', tabId, generation: message.generation});
      return;
    }
    case 'disable': {
      const session = sessions.get(tabId);
      if (session?.started === true) await sendToOffscreen({target: 'offscreen', type: 'disable', tabId, generation: Math.max(message.generation, session.generation)});
      if (session !== undefined) sessions.set(tabId, {...session, started: false, generation: Math.max(message.generation, session.generation)});
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
      if (session.started) await sendToOffscreen({target: 'offscreen', type: 'start', tabId, pageUrl: nextSession.pageUrl, mediaKey: nextSession.mediaKey, candidate: nextSession.candidate, generation: nextSession.generation, videoTimeSamples: nextSession.videoTimeSamples, dialnorm: nextSession.dialnorm});
      return;
    }
    case 'request-manifest':
    case 'offscreen-status':
      return;
  }
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

function base64ByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

chrome.action.onClicked.addListener((tab: ChromeTab): void => {
  if (tab.id === undefined) return;
  void chrome.tabs.sendMessage(tab.id, {target: 'background', type: 'toggle'}).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((rawMessage: unknown, sender: ChromeMessageSender): void => {
  if (!isRuntimeMessage(rawMessage)) return;
  if (rawMessage.target === 'background') {
    const senderTabId = tabIdFromSender(sender);
    if (senderTabId !== null) {
      void handleContentMessage(rawMessage, senderTabId).catch(() => undefined);
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
  if (session !== undefined && rawMessage.generation >= session.generation) {
    sessions.set(rawMessage.tabId, {...session, started: rawMessage.phase !== 'disabled' && rawMessage.phase !== 'error', generation: rawMessage.generation});
    void chrome.tabs.sendMessage(rawMessage.tabId, rawMessage).catch(() => undefined);
  }
});
