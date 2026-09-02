// pattern: Functional Core

export type MockMediaRange = Readonly<{
  readonly start: number;
  readonly end: number;
  readonly ptsSamples: number;
  readonly durationSamples: number;
}>;

export type MockBilibiliEvent =
  | Readonly<{readonly type: 'play'; readonly mediaTimeSamples: number}>
  | Readonly<{readonly type: 'pause'; readonly mediaTimeSamples: number}>
  | Readonly<{readonly type: 'seek'; readonly mediaTimeSamples: number}>
  | Readonly<{readonly type: 'buffering'; readonly mediaTimeSamples: number}>
  | Readonly<{readonly type: 'media-change'; readonly mediaKey: string}>;

export type MockBilibiliScenario = Readonly<{
  readonly mediaKey: Readonly<{readonly bvid: string; readonly aid: string; readonly cid: string}>;
  readonly initializationRange: Readonly<{readonly start: number; readonly end: number}>;
  readonly mediaRanges: ReadonlyArray<MockMediaRange>;
  readonly events: ReadonlyArray<MockBilibiliEvent>;
}>;

/** Creates a deterministic local Bilibili adapter scenario for lifecycle tests. */
export function createMockBilibiliScenario(): MockBilibiliScenario {
  return {
    mediaKey: {bvid: 'BV-openjoc-mock', aid: '1001', cid: '2001'},
    initializationRange: {start: 0, end: 1_023},
    mediaRanges: [
      {start: 1_024, end: 2_047, ptsSamples: 0, durationSamples: 1536},
      {start: 2_048, end: 3_071, ptsSamples: 1536, durationSamples: 1536},
      {start: 3_072, end: 4_095, ptsSamples: 3072, durationSamples: 1536},
    ],
    events: [
      {type: 'play', mediaTimeSamples: 0},
      {type: 'pause', mediaTimeSamples: 1536},
      {type: 'play', mediaTimeSamples: 1536},
      {type: 'seek', mediaTimeSamples: 3_072},
      {type: 'buffering', mediaTimeSamples: 3_072},
      {type: 'media-change', mediaKey: 'BV-openjoc-next'},
    ],
  };
}
