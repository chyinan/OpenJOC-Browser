// pattern: Functional Core

import type {BilibiliAudioCandidate} from './extension-protocol.js';

/** Extracts only Dolby/E-AC-3 audio candidates from an untrusted playurl payload. */
export function extractBilibiliAudioCandidates(payload: unknown): ReadonlyArray<BilibiliAudioCandidate> {
  const root = asRecord(payload);
  const data = asRecord(getProperty(root, 'data'));
  const dash = asRecord(getProperty(data, 'dash'));
  const result: Array<BilibiliAudioCandidate> = [];
  const seen = new Set<string>();
  collectCandidates(asArray(getProperty(dash, 'dolby') && getProperty(asRecord(getProperty(dash, 'dolby')), 'audio')), 'dolby', result, seen);
  collectCandidates(asArray(getProperty(dash, 'audio')), 'ec-3', result, seen);
  const topLevelDolby = asRecord(getProperty(data, 'dolby'));
  collectCandidates(asArray(getProperty(topLevelDolby, 'audio')), 'dolby', result, seen);
  return result;
}

function collectCandidates(
  values: ReadonlyArray<unknown>,
  source: 'dolby' | 'ec-3',
  result: Array<BilibiliAudioCandidate>,
  seen: Set<string>,
): void {
  values.forEach((value, index) => {
    const candidate = asRecord(value);
    const baseUrl = firstString(getProperty(candidate, 'baseUrl'), getProperty(candidate, 'base_url'));
    const codecs = nullableString(getProperty(candidate, 'codecs'));
    if (baseUrl === null || (source === 'ec-3' && !(codecs?.toLowerCase().includes('ec-3') ?? false))) {
      return;
    }
    const idValue = getProperty(candidate, 'id');
    const id = typeof idValue === 'string' && idValue.length > 0
      ? idValue
      : typeof idValue === 'number' && Number.isSafeInteger(idValue)
        ? String(idValue)
        : `${source}-${index}`;
    const identity = `${source}:${id}:${baseUrl}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    result.push({
      id,
      source,
      codecs,
      mimeType: nullableString(getProperty(candidate, 'mimeType')) ?? nullableString(getProperty(candidate, 'mime_type')),
      bandwidth: nullableFiniteNumber(getProperty(candidate, 'bandwidth')),
      baseUrl,
      backupUrls: asArray(getProperty(candidate, 'backupUrl') ?? getProperty(candidate, 'backup_url')).filter((url): url is string => typeof url === 'string'),
    });
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

function getProperty(value: Record<string, unknown> | null, key: string): unknown {
  return value !== null && Object.hasOwn(value, key) ? value[key] : null;
}

function firstString(first: unknown, second: unknown): string | null {
  return typeof first === 'string' && first.length > 0 ? first : typeof second === 'string' && second.length > 0 ? second : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function nullableFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
