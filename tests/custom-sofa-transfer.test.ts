// pattern: Functional Core

import {CUSTOM_SOFA_CHUNK_BYTES, customSofaChunkCount, expectedCustomSofaChunkLength, isValidCustomSofaBase64, MAX_CUSTOM_SOFA_BYTES} from '../src/custom-sofa-transfer.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  assert(customSofaChunkCount(1) === 1, 'a non-empty file uses at least one chunk');
  assert(customSofaChunkCount(MAX_CUSTOM_SOFA_BYTES + 1) === null, 'files above the Browser SOFA memory budget are rejected');
  assert(customSofaChunkCount(CUSTOM_SOFA_CHUNK_BYTES + 1) === 2, 'large files are split below the runtime-message bound');
  assert(expectedCustomSofaChunkLength(CUSTOM_SOFA_CHUNK_BYTES + 1, 0) === CUSTOM_SOFA_CHUNK_BYTES, 'the first chunk has the fixed payload size');
  assert(expectedCustomSofaChunkLength(CUSTOM_SOFA_CHUNK_BYTES + 1, 1) === 1, 'the final chunk uses only the remaining bytes');
  assert(expectedCustomSofaChunkLength(1, 1) === null, 'out-of-range chunk indexes are rejected');
  assert(isValidCustomSofaBase64('AQIDBA=='), 'valid base64 chunk data is accepted');
  assert(!isValidCustomSofaBase64('not base64!'), 'malformed base64 chunk data is rejected');
}

run();
