// pattern: Functional Core

import type {CmafSegmentIndex, CmafSegmentReference} from './cmaf-transport.js';

type CmafWindowOptions = Readonly<{
  readonly timescale: number;
  readonly earliestPresentationTime: number;
  readonly references: ReadonlyArray<CmafSegmentReference>;
}>;

/** Selects a bounded segment window containing the video-master target time. */
export function selectCmafSegmentWindow(
  index: Readonly<CmafSegmentIndex> & CmafWindowOptions,
  targetMediaSamples: number,
  maxSegments: number,
): ReadonlyArray<CmafSegmentReference> {
  if (!Number.isSafeInteger(targetMediaSamples) || targetMediaSamples < 0) {
    throw new Error('CMAF target media time is invalid');
  }
  if (!Number.isSafeInteger(maxSegments) || maxSegments <= 0) {
    throw new Error('CMAF segment window size is invalid');
  }
  const first = index.references[0];
  if (first === undefined || targetMediaSamples < first.ptsSamples) {
    return index.references.slice(0, maxSegments);
  }
  const start = index.references.findIndex((reference) => targetMediaSamples >= reference.ptsSamples && targetMediaSamples < reference.ptsSamples + reference.durationSamples);
  return start < 0 ? [] : index.references.slice(start, start + maxSegments);
}
