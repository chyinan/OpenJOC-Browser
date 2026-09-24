// pattern: Imperative Shell

import {abortCustomSofaImport, beginCustomSofaImport, commitCustomSofaImport, discardCustomSofaAsset, loadCustomSofaAsset, writeCustomSofaImportChunk} from '../src/custom-sofa-storage.js';

type RequestLike = {
  result: unknown;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
};

class MemoryTransaction {
  public oncomplete: (() => void) | null = null;
  public onabort: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  private pending = 0;
  private aborted = false;
  private completionQueued = false;

  public constructor(private readonly records: Map<string, Record<string, unknown>>) {}

  public objectStore(_name: string): MemoryObjectStore {
    return new MemoryObjectStore(this, this.records);
  }

  public request<TValue>(operation: () => TValue): RequestLike {
    this.pending += 1;
    const request: RequestLike = {result: undefined, error: null, onsuccess: null, onerror: null};
    queueMicrotask(() => {
      try {
        if (this.aborted) throw new Error('transaction aborted');
        request.result = operation();
        request.onsuccess?.();
      } catch (error: unknown) {
        request.error = error instanceof Error ? error : new Error(String(error));
        request.onerror?.();
        this.abort();
      } finally {
        this.pending -= 1;
        this.scheduleComplete();
      }
    });
    return request;
  }

  public abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    queueMicrotask(() => this.onabort?.());
  }

  private scheduleComplete(): void {
    if (this.pending !== 0 || this.aborted || this.completionQueued) return;
    this.completionQueued = true;
    queueMicrotask(() => {
      this.completionQueued = false;
      if (this.pending === 0 && !this.aborted) this.oncomplete?.();
    });
  }
}

class MemoryObjectStore {
  public constructor(
    private readonly transaction: MemoryTransaction,
    private readonly records: Map<string, Record<string, unknown>>,
  ) {}

  public get(key: string): RequestLike {
    return this.transaction.request(() => {
      const value = this.records.get(key);
      return value === undefined ? undefined : structuredClone(value);
    });
  }

  public getAll(): RequestLike {
    return this.transaction.request(() => [...this.records.values()].map((value) => structuredClone(value)));
  }

  public getAllKeys(): RequestLike {
    return this.transaction.request(() => [...this.records.keys()]);
  }

  public put(value: Record<string, unknown>): RequestLike {
    return this.transaction.request(() => {
      const key = value.key;
      if (typeof key !== 'string') throw new Error('memory IndexedDB requires string keys');
      this.records.set(key, structuredClone(value));
      return key;
    });
  }

  public delete(key: string): RequestLike {
    return this.transaction.request(() => this.records.delete(key));
  }
}

function installMemoryIndexedDb(): Map<string, Record<string, unknown>> {
  const records = new Map<string, Record<string, unknown>>();
  const database = {
    objectStoreNames: {contains: () => true},
    createObjectStore() {},
    transaction: () => new MemoryTransaction(records),
  };
  let isCreated = false;
  const factory = {
    open() {
      const request: RequestLike & {onupgradeneeded: (() => void) | null} = {
        result: database,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        if (!isCreated) {
          isCreated = true;
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      });
      return request;
    },
  };
  Object.defineProperty(globalThis, 'indexedDB', {configurable: true, value: factory});
  return records;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function run(): Promise<void> {
  const records = installMemoryIndexedDb();
  const previousId = '11111111-1111-4111-8111-111111111111';
  const nextId = '22222222-2222-4222-8222-222222222222';
  const previousBytes = new Uint8Array([1, 3, 5, 7]);
  await beginCustomSofaImport(previousId, previousBytes.byteLength, null);
  await writeCustomSofaImportChunk(previousId, 0, previousBytes);
  const previous = await commitCustomSofaImport(previousId);
  const previousLoaded = await loadCustomSofaAsset(previous.sha256);
  assert(previousLoaded !== null && previousLoaded.bytes.join(',') === '1,3,5,7', 'committed SOFA bytes survive a local storage round trip');

  const duplicateId = '55555555-5555-4555-8555-555555555555';
  await beginCustomSofaImport(duplicateId, previousBytes.byteLength, previous.sha256);
  await writeCustomSofaImportChunk(duplicateId, 0, previousBytes);
  const duplicate = await commitCustomSofaImport(duplicateId);
  assert(!duplicate.created && duplicate.revision === previous.revision, 'reimporting identical bytes reuses the active asset revision');
  if (duplicate.created) await discardCustomSofaAsset(duplicate.sha256, duplicate.revision);
  assert(await loadCustomSofaAsset(previous.sha256) !== null, 'failed duplicate-file prevalidation does not delete the previously selected asset');

  const nextBytes = new Uint8Array([2, 4, 6, 8]);
  await beginCustomSofaImport(nextId, nextBytes.byteLength, previous.sha256);
  await writeCustomSofaImportChunk(nextId, 0, nextBytes);
  const next = await commitCustomSofaImport(nextId);
  assert(await loadCustomSofaAsset(previous.sha256) !== null, 'the previously active file remains available for rollback');
  const nextLoaded = await loadCustomSofaAsset(next.sha256);
  assert(nextLoaded !== null && nextLoaded.bytes.join(',') === '2,4,6,8', 'the new SOFA asset is addressable by its integrity hash');

  const staleId = '33333333-3333-4333-8333-333333333333';
  const latestId = '44444444-4444-4444-8444-444444444444';
  await beginCustomSofaImport(staleId, 1, next.sha256);
  await writeCustomSofaImportChunk(staleId, 0, new Uint8Array([9]));
  const subtle = crypto.subtle;
  const digestOriginal = subtle.digest.bind(subtle);
  const signals: {resolveStarted: () => void; release: () => void} = {resolveStarted: () => undefined, release: () => undefined};
  const digestStarted = new Promise<void>((resolve) => {signals.resolveStarted = resolve;});
  const digestGate = new Promise<void>((resolve) => {signals.release = resolve;});
  let blockFirstDigest = true;
  Object.defineProperty(subtle, 'digest', {
    configurable: true,
    value: async (algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> => {
      if (blockFirstDigest) {
        blockFirstDigest = false;
        signals.resolveStarted();
        await digestGate;
      }
      return digestOriginal(algorithm, data);
    },
  });
  let staleCommit: Promise<unknown>;
  try {
    staleCommit = commitCustomSofaImport(staleId);
    await digestStarted;
    await beginCustomSofaImport(latestId, 1, next.sha256);
    await writeCustomSofaImportChunk(latestId, 0, new Uint8Array([10]));
  } finally {
    signals.release();
    Reflect.deleteProperty(subtle, 'digest');
  }
  let staleCommitRejected = false;
  try {
    await staleCommit!;
  } catch {
    staleCommitRejected = true;
  }
  assert(staleCommitRejected, 'a superseded import cannot replace the committed asset');
  const latest = await commitCustomSofaImport(latestId);
  assert(await loadCustomSofaAsset(next.sha256) !== null, 'the current custom selection remains rollback-capable');
  assert(await loadCustomSofaAsset(latest.sha256) !== null, 'the latest completed import is available');

  const corruptKey = `custom-sofa:${latest.sha256}`;
  const corruptEntry = records.get(corruptKey);
  if (corruptEntry === undefined) throw new Error('committed Custom SOFA storage record is missing');
  corruptEntry.bytes = new Uint8Array([0]).buffer;
  records.set(corruptKey, corruptEntry);

  const freshId = '66666666-6666-4666-8666-666666666666';
  const loadSubtle = crypto.subtle;
  const loadDigestOriginal = loadSubtle.digest.bind(loadSubtle);
  const loadSignals: {resolveStarted: () => void; release: () => void} = {resolveStarted: () => undefined, release: () => undefined};
  const loadDigestStarted = new Promise<void>((resolve) => {loadSignals.resolveStarted = resolve;});
  const loadDigestGate = new Promise<void>((resolve) => {loadSignals.release = resolve;});
  let blockLoadDigest = true;
  Object.defineProperty(loadSubtle, 'digest', {
    configurable: true,
    value: async (algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> => {
      if (blockLoadDigest) {
        blockLoadDigest = false;
        loadSignals.resolveStarted();
        await loadDigestGate;
      }
      return loadDigestOriginal(algorithm, data);
    },
  });
  let staleLoad: Promise<unknown>;
  try {
    staleLoad = loadCustomSofaAsset(latest.sha256);
    await loadDigestStarted;
    await beginCustomSofaImport(freshId, 1, next.sha256);
    await writeCustomSofaImportChunk(freshId, 0, new Uint8Array([10]));
    await commitCustomSofaImport(freshId);
  } finally {
    loadSignals.release();
    Reflect.deleteProperty(loadSubtle, 'digest');
  }
  assert(await staleLoad! === null, 'corrupt bytes observed by a stale load are rejected');
  assert(records.has(corruptKey), 'stale corruption cleanup does not delete a newer valid revision');
  assert(await loadCustomSofaAsset(latest.sha256) !== null, 'the replacement bytes remain available after the stale load finishes');
  await abortCustomSofaImport(staleId);
}

await run();
