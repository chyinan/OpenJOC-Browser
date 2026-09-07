// pattern: Functional Core

export const OUTPUT_GAIN_MIN_DB = -12;
export const OUTPUT_GAIN_MAX_DB = 12;
export const OUTPUT_GAIN_STEP_DB = 0.5;
export const OUTPUT_GAIN_DEFAULT_DB = 0;
export const OUTPUT_GAIN_MAX_AMPLITUDE = 10 ** (OUTPUT_GAIN_MAX_DB / 20);

export function isOutputGainDb(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= OUTPUT_GAIN_MIN_DB && value <= OUTPUT_GAIN_MAX_DB;
}

export function normalizeOutputGainDb(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return OUTPUT_GAIN_DEFAULT_DB;
  const bounded = Math.min(OUTPUT_GAIN_MAX_DB, Math.max(OUTPUT_GAIN_MIN_DB, value));
  const stepped = Math.round(bounded / OUTPUT_GAIN_STEP_DB) * OUTPUT_GAIN_STEP_DB;
  return stepped === 0 ? 0 : stepped;
}

export function gainDbToAmplitude(gainDb: number): number {
  return isOutputGainDb(gainDb) ? 10 ** (gainDb / 20) : 1;
}
