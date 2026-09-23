// pattern: Imperative Shell

import {createHash} from 'node:crypto';

export function validatePinnedHrtfAssetBaseUrl(value, assetVersion) {
  let baseUrl;
  try {
    baseUrl = new URL(value);
  } catch {
    throw new Error('built-in HRTF asset base URL is invalid');
  }
  const expectedBaseUrl = `https://github.com/chyinan/OpenJOC/releases/download/${assetVersion}/`;
  if (baseUrl.href !== expectedBaseUrl) {
    throw new Error('built-in HRTF asset base URL must match the pinned OpenJOC release');
  }
  return baseUrl;
}

/** Streams a release response into a SHA-256 check without buffering the HRTF asset. */
export async function verifyHrtfAssetResponse(response, descriptor) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`remote HRTF asset ${descriptor.presetId} returned HTTP ${response.status}`);
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null
    && (!/^\d+$/u.test(contentLength) || Number(contentLength) !== descriptor.byteLength)) {
    await response.body?.cancel();
    throw new Error(`remote HRTF asset ${descriptor.presetId} content-length does not match the manifest`);
  }
  if (response.body === null) throw new Error(`remote HRTF asset ${descriptor.presetId} has no response body`);

  const hash = createHash('sha256');
  const reader = response.body.getReader();
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength > descriptor.byteLength - byteLength) {
        await reader.cancel();
        throw new Error(`remote HRTF asset ${descriptor.presetId} exceeds the manifest byte length`);
      }
      byteLength += chunk.value.byteLength;
      hash.update(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (byteLength !== descriptor.byteLength) {
    throw new Error(`remote HRTF asset ${descriptor.presetId} byte length does not match the manifest`);
  }
  const sha256 = hash.digest('hex');
  if (sha256 !== descriptor.sha256) {
    throw new Error(`remote HRTF asset ${descriptor.presetId} SHA-256 does not match the manifest`);
  }
  return {byteLength, sha256};
}
