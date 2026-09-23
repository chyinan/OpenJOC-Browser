import {canStartDecode, isCurrentGeneration, shouldRecreateWorkerForGeneration} from '../src/generation.js';
import {DecoderGenerationSlot} from '../src/decoder-generation.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  assert(canStartDecode(0, null, 1), 'first generation can start');
  assert(!canStartDecode(1, 1, 1), 'duplicate generation cannot start');
  assert(!canStartDecode(2, 1, 1), 'stale generation cannot start after reset');
  assert(canStartDecode(2, 1, 2), 'new generation can replace stale work');
  assert(isCurrentGeneration(2, 2), 'current PCM message is accepted');
  assert(!isCurrentGeneration(1, 2), 'old PCM/EOS message is rejected');
  assert(shouldRecreateWorkerForGeneration(14, 1), 'a generation rollback recreates the worker');
  assert(shouldRecreateWorkerForGeneration(14, 14), 'an equal-generation restart recreates the worker to clear queued commands');
  assert(!shouldRecreateWorkerForGeneration(14, 15), 'a forward generation can safely reuse the worker');
  assert(!shouldRecreateWorkerForGeneration(null, 1), 'the first generation does not recreate a missing worker');
}

async function runAsync(): Promise<void> {
  type FakeDecoder = {readonly id: string};
  type Deferred = {readonly promise: Promise<FakeDecoder>; resolve(decoder: FakeDecoder): void};
  const destroyed: Array<string> = [];
  const deferred = (): Deferred => {
    let resolvePromise: ((decoder: FakeDecoder) => void) | null = null;
    const promise = new Promise<FakeDecoder>((resolve) => {
      resolvePromise = resolve;
    });
    return {
      promise,
      resolve(decoder: FakeDecoder): void {
        resolvePromise?.(decoder);
      },
    };
  };
  const first = deferred();
  const second = deferred();
  let loadCount = 0;
  const loadSignals: Array<AbortSignal> = [];
  const slot = new DecoderGenerationSlot<FakeDecoder>(
    async (signal: AbortSignal): Promise<FakeDecoder> => {
      loadCount += 1;
      loadSignals.push(signal);
      return loadCount === 1 ? first.promise : second.promise;
    },
    (decoder): void => {
      destroyed.push(decoder.id);
    },
  );

  const oldLoad = slot.start(1);
  const newLoad = slot.start(2);
  second.resolve({id: 'new'});
  assert((await newLoad)?.id === 'new', 'new decoder becomes current');
  assert(loadSignals[0]?.aborted === true, 'newer selection aborts the previous pending asset load');
  first.resolve({id: 'old'});
  assert((await oldLoad) === null, 'late old decoder is rejected');
  assert(slot.current()?.id === 'new', 'late old load cannot clear new decoder');
  assert(destroyed.includes('old'), 'late old decoder is destroyed locally');

  const staleReplacement = deferred();
  const canceledLoads: Array<string> = [];
  let requestedLoadCount = 0;
  const canceledSlot = new DecoderGenerationSlot<FakeDecoder>(
    async (): Promise<FakeDecoder> => {
      requestedLoadCount += 1;
      return requestedLoadCount === 1 ? {id: 'active-before-cancel'} : staleReplacement.promise;
    },
    (decoder): void => {
      canceledLoads.push(decoder.id);
    },
  );
  const activeBeforeCancel = await canceledSlot.start(1);
  canceledSlot.finish(1);
  const pendingReplacement = canceledSlot.start(2);
  canceledSlot.cancelPendingLoad();
  staleReplacement.resolve({id: 'late-canceled-replacement'});
  assert((await pendingReplacement) === null, 'an aborted load cannot commit after non-abortable digest work settles');
  assert(canceledSlot.current() === activeBeforeCancel, 'canceled replacement preserves the active decoder');
  assert(canceledLoads.includes('late-canceled-replacement'), 'late decoder from a canceled load is destroyed');

  let replacementAttempts = 0;
  const retainedSlot = new DecoderGenerationSlot<FakeDecoder>(
    async (): Promise<FakeDecoder> => {
      replacementAttempts += 1;
      if (replacementAttempts === 1) return {id: 'working'};
      throw new Error('asset checksum mismatch');
    },
    (decoder): void => {
      destroyed.push(decoder.id);
    },
  );
  const working = await retainedSlot.start(1);
  retainedSlot.finish(1);
  try {
    await retainedSlot.start(2);
  } catch {
    // A rejected replacement must leave the active decoder intact.
  }
  assert(retainedSlot.current() === working, 'failed replacement keeps the previous decoder');
  assert(!destroyed.includes('working'), 'the previous decoder is not destroyed on failed load');
}

run();
await runAsync();
