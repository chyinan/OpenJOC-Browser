// pattern: Imperative Shell

import {customSofaChunkCount, expectedCustomSofaChunkLength, MAX_CUSTOM_SOFA_BYTES} from './custom-sofa-transfer.js';

const DATABASE_NAME = 'openjoc-custom-sofa';
const DATABASE_VERSION = 1;
const STORE_NAME = 'assets';
const CUSTOM_SOFA_KEY_PREFIX = 'custom-sofa:';
const ASSET_SCHEMA_VERSION = 1;

type StagingMetadata = Readonly<{
  readonly key: string;
  readonly kind: 'staging-metadata';
  readonly transferId: string;
  readonly byteLength: number;
  readonly chunkCount: number;
  readonly receivedChunkCount: number;
  readonly preserveSha256: string | null;
}>;

type StagingChunk = Readonly<{
  readonly key: string;
  readonly kind: 'staging-chunk';
  readonly transferId: string;
  readonly index: number;
  readonly bytes: ArrayBuffer;
}>;

type StoredCustomSofa = Readonly<{
  readonly key: string;
  readonly kind: 'custom-sofa';
  readonly schemaVersion: number;
  readonly byteLength: number;
  readonly sha256: string;
  readonly revision: string;
  readonly bytes: ArrayBuffer;
}>;

export type CustomSofaAsset = Readonly<{
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly sha256: string;
  readonly revision: string;
}>;

export type CommittedCustomSofaAsset = CustomSofaAsset & Readonly<{readonly created: boolean}>;

let databasePromise: Promise<IDBDatabase> | null = null;

export async function beginCustomSofaImport(
  transferId: string,
  byteLength: number,
  preserveSha256: string | null,
): Promise<void> {
  if (!isTransferId(transferId)
    || customSofaChunkCount(byteLength) === null
    || (preserveSha256 !== null && !isSha256(preserveSha256))) {
    throw new Error('invalid Custom SOFA import size or transfer identity');
  }
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const transactionFinished = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  const keys = await requestResult(store.getAllKeys());
  for (const key of keys) {
    if (typeof key === 'string' && key.startsWith('staging:')) store.delete(key);
  }
  const chunkCount = customSofaChunkCount(byteLength);
  if (chunkCount === null) throw new Error('invalid Custom SOFA import size');
  store.put({
    key: metadataKey(transferId),
    kind: 'staging-metadata',
    transferId,
    byteLength,
    chunkCount,
    receivedChunkCount: 0,
    preserveSha256,
  } satisfies StagingMetadata);
  await transactionFinished;
}

export async function writeCustomSofaImportChunk(
  transferId: string,
  index: number,
  bytes: Uint8Array,
): Promise<void> {
  if (!isTransferId(transferId)) throw new Error('invalid Custom SOFA transfer identity');
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const transactionFinished = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  const metadata = await requestResult(store.get(metadataKey(transferId)));
  if (!isStagingMetadata(metadata, transferId)
    || index !== metadata.receivedChunkCount
    || expectedCustomSofaChunkLength(metadata.byteLength, index) !== bytes.byteLength) {
    transaction.abort();
    await transactionFinished.catch(() => undefined);
    throw new Error('invalid or out-of-order Custom SOFA chunk');
  }
  const copiedBytes = bytes.slice().buffer as ArrayBuffer;
  store.put({
    key: chunkKey(transferId, index),
    kind: 'staging-chunk',
    transferId,
    index,
    bytes: copiedBytes,
  } satisfies StagingChunk);
  store.put({...metadata, receivedChunkCount: metadata.receivedChunkCount + 1} satisfies StagingMetadata);
  await transactionFinished;
}

export async function commitCustomSofaImport(
  transferId: string,
  preserveShaOverride?: string | null,
): Promise<CommittedCustomSofaAsset> {
  if (!isTransferId(transferId)) throw new Error('invalid Custom SOFA transfer identity');
  const database = await openDatabase();
  const readTransaction = database.transaction(STORE_NAME, 'readonly');
  const readFinished = transactionDone(readTransaction);
  const entries = await requestResult(readTransaction.objectStore(STORE_NAME).getAll()) as Array<unknown>;
  await readFinished;
  const metadata = entries.find((entry) => isRecord(entry) && entry.key === metadataKey(transferId));
  if (!isStagingMetadata(metadata, transferId)
    || metadata.receivedChunkCount !== metadata.chunkCount) {
    throw new Error('Custom SOFA import is incomplete');
  }
  if (preserveShaOverride !== undefined && preserveShaOverride !== null && !isSha256(preserveShaOverride)) {
    throw new Error('invalid active Custom SOFA revision');
  }
  const preserveSha256 = preserveShaOverride === undefined ? metadata.preserveSha256 : preserveShaOverride;
  const chunks = new Map<number, StagingChunk>();
  for (const entry of entries) {
    if (isStagingChunk(entry, transferId)) chunks.set(entry.index, entry);
  }
  const expectedCount = customSofaChunkCount(metadata.byteLength);
  if (expectedCount === null || chunks.size !== expectedCount) throw new Error('Custom SOFA import is incomplete');
  const bytes = new Uint8Array(metadata.byteLength);
  let offset = 0;
  for (let index = 0; index < expectedCount; index += 1) {
    const chunk = chunks.get(index);
    const expectedLength = expectedCustomSofaChunkLength(metadata.byteLength, index);
    if (chunk === undefined || expectedLength === null || chunk.bytes.byteLength !== expectedLength) {
      throw new Error('Custom SOFA import contains an invalid chunk');
    }
    bytes.set(new Uint8Array(chunk.bytes), offset);
    offset += chunk.bytes.byteLength;
  }
  if (offset !== metadata.byteLength) throw new Error('Custom SOFA import size does not match');
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  const sha256 = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  const storedBytes = bytes.buffer as ArrayBuffer;
  const writeTransaction = database.transaction(STORE_NAME, 'readwrite');
  const writeFinished = transactionDone(writeTransaction);
  const store = writeTransaction.objectStore(STORE_NAME);
  const currentMetadata = await requestResult(store.get(metadataKey(transferId)));
  if (!isStagingMetadata(currentMetadata, transferId)
    || currentMetadata.receivedChunkCount !== currentMetadata.chunkCount) {
    writeTransaction.abort();
    await writeFinished.catch(() => undefined);
    throw new Error('Custom SOFA import was superseded by a newer selection');
  }
  const identicalAsset = entries.find((entry): entry is StoredCustomSofa =>
    isStoredCustomSofa(entry)
      && entry.sha256 === sha256
      && entry.byteLength === storedBytes.byteLength
      && equalBytes(entry.bytes, storedBytes));
  const assetRevision = identicalAsset?.revision ?? transferId;
  const created = identicalAsset === undefined;
  if (created) {
    store.put({
      key: customSofaAssetKey(sha256),
      kind: 'custom-sofa',
      schemaVersion: ASSET_SCHEMA_VERSION,
      byteLength: storedBytes.byteLength,
      sha256,
      revision: transferId,
      bytes: storedBytes,
    } satisfies StoredCustomSofa);
  }
  for (const entry of entries) {
    if (isStagingMetadata(entry, transferId) || isStagingChunk(entry, transferId)) store.delete(entry.key);
    if (isStoredCustomSofa(entry)
      && entry.sha256 !== sha256
      && entry.sha256 !== preserveSha256) store.delete(entry.key);
  }
  await writeFinished;
  return {bytes, byteLength: storedBytes.byteLength, sha256, revision: assetRevision, created};
}

export async function abortCustomSofaImport(transferId: string): Promise<void> {
  if (!isTransferId(transferId)) return;
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const transactionFinished = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  const entries = await requestResult(store.getAll()) as Array<unknown>;
  for (const entry of entries) {
    if (isStagingMetadata(entry, transferId) || isStagingChunk(entry, transferId)) store.delete(entry.key);
  }
  await transactionFinished;
}

export async function loadCustomSofaAsset(expectedSha256: string | null): Promise<CustomSofaAsset | null> {
  if (!isSha256(expectedSha256)) return null;
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const transactionFinished = transactionDone(transaction);
  const entry = await requestResult(transaction.objectStore(STORE_NAME).get(customSofaAssetKey(expectedSha256)));
  await transactionFinished;
  if (!isStoredCustomSofa(entry) || entry.sha256 !== expectedSha256) return null;
  if (entry.schemaVersion !== ASSET_SCHEMA_VERSION
    || entry.byteLength !== entry.bytes.byteLength
    || entry.byteLength > MAX_CUSTOM_SOFA_BYTES) {
    await deleteCustomSofaAssetIfRevision(entry.sha256, entry.revision);
    return null;
  }
  const digest = await crypto.subtle.digest('SHA-256', entry.bytes);
  const actualHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  if (actualHash !== entry.sha256) {
    await deleteCustomSofaAssetIfRevision(entry.sha256, entry.revision);
    return null;
  }
  return {bytes: new Uint8Array(entry.bytes), byteLength: entry.byteLength, sha256: entry.sha256, revision: entry.revision};
}

async function deleteCustomSofaAssetIfRevision(sha256: string, revision: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const transactionFinished = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  const entry = await requestResult(store.get(customSofaAssetKey(sha256)));
  if (isStoredCustomSofa(entry) && entry.sha256 === sha256 && entry.revision === revision) {
    store.delete(customSofaAssetKey(sha256));
  }
  await transactionFinished;
}

export async function discardCustomSofaAsset(sha256: string, revision: string): Promise<void> {
  if (!isSha256(sha256) || !isTransferId(revision)) return;
  await deleteCustomSofaAssetIfRevision(sha256, revision);
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise !== null) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (): void => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, {keyPath: 'key'});
      }
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('failed to open Custom SOFA storage'));
    request.onblocked = (): void => reject(new Error('Custom SOFA storage upgrade is blocked'));
  });
  return databasePromise;
}

function requestResult<TValue>(request: IDBRequest<TValue>): Promise<TValue> {
  return new Promise<TValue>((resolve, reject) => {
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('Custom SOFA storage request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = (): void => resolve();
    transaction.onabort = (): void => reject(transaction.error ?? new Error('Custom SOFA storage transaction aborted'));
    transaction.onerror = (): void => reject(transaction.error ?? new Error('Custom SOFA storage transaction failed'));
  });
}

function isStagingMetadata(value: unknown, transferId: string): value is StagingMetadata {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StagingMetadata>;
  return candidate.kind === 'staging-metadata'
    && candidate.transferId === transferId
    && candidate.key === metadataKey(transferId)
    && typeof candidate.byteLength === 'number'
    && customSofaChunkCount(candidate.byteLength) === candidate.chunkCount
    && (candidate.preserveSha256 === null || isSha256(candidate.preserveSha256))
    && Number.isSafeInteger(candidate.receivedChunkCount)
    && (candidate.receivedChunkCount ?? -1) >= 0
    && (candidate.receivedChunkCount ?? Number.MAX_SAFE_INTEGER) <= candidate.chunkCount;
}

function isStagingChunk(value: unknown, transferId: string): value is StagingChunk {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<StagingChunk>;
  return candidate.kind === 'staging-chunk'
    && candidate.transferId === transferId
    && Number.isSafeInteger(candidate.index)
    && (candidate.index ?? -1) >= 0
    && typeof candidate.key === 'string'
    && candidate.key === chunkKey(transferId, candidate.index ?? -1)
    && candidate.bytes instanceof ArrayBuffer;
}

function isStoredCustomSofa(value: unknown): value is StoredCustomSofa {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredCustomSofa>;
  return typeof candidate.sha256 === 'string'
    && candidate.key === customSofaAssetKey(candidate.sha256)
    && candidate.kind === 'custom-sofa'
    && typeof candidate.schemaVersion === 'number'
    && typeof candidate.byteLength === 'number'
    && isSha256(candidate.sha256)
    && typeof candidate.revision === 'string'
    && isTransferId(candidate.revision)
    && candidate.bytes instanceof ArrayBuffer;
}

function isTransferId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function equalBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left.byteLength !== right.byteLength) return false;
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
}

function metadataKey(transferId: string): string {
  return `staging:${transferId}:metadata`;
}

function chunkKey(transferId: string, index: number): string {
  return `staging:${transferId}:chunk:${index.toString().padStart(6, '0')}`;
}

function customSofaAssetKey(sha256: string): string {
  return `${CUSTOM_SOFA_KEY_PREFIX}${sha256}`;
}
