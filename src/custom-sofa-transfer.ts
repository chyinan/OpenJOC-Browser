// pattern: Functional Core

export const MAX_CUSTOM_SOFA_BYTES = 16 * 1024 * 1024;
export const CUSTOM_SOFA_CHUNK_BYTES = 512 * 1024;

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function customSofaChunkCount(byteLength: number): number | null {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > MAX_CUSTOM_SOFA_BYTES) return null;
  return Math.ceil(byteLength / CUSTOM_SOFA_CHUNK_BYTES);
}

export function expectedCustomSofaChunkLength(byteLength: number, index: number): number | null {
  const chunkCount = customSofaChunkCount(byteLength);
  if (chunkCount === null || !Number.isSafeInteger(index) || index < 0 || index >= chunkCount) return null;
  return Math.min(CUSTOM_SOFA_CHUNK_BYTES, byteLength - index * CUSTOM_SOFA_CHUNK_BYTES);
}

export function isValidCustomSofaBase64(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 700_000 && BASE64_PATTERN.test(value);
}
