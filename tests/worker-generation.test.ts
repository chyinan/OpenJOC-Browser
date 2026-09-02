import {canStartDecode, isCurrentGeneration} from '../src/generation.js';
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
  const slot = new DecoderGenerationSlot<FakeDecoder>(
    async (): Promise<FakeDecoder> => {
      loadCount += 1;
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
  first.resolve({id: 'old'});
  assert((await oldLoad) === null, 'late old decoder is rejected');
  assert(slot.current()?.id === 'new', 'late old load cannot clear new decoder');
  assert(destroyed.includes('old'), 'late old decoder is destroyed locally');
}

run();
await runAsync();
