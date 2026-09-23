// pattern: Functional Core

export type HrtfPreset = 'sadie-ii-d1-ku100' | 'sadie-ii-d2-kemar' | 'aachen-high-resolution-kemar';

export type HrtfPresetOption = Readonly<{
  readonly id: HrtfPreset;
  readonly label: string;
}>;

export const HRTF_PRESET_OPTIONS: ReadonlyArray<HrtfPresetOption> = [
  {id: 'sadie-ii-d1-ku100', label: 'SADIE II — KU100'},
  {id: 'sadie-ii-d2-kemar', label: 'SADIE II — KEMAR'},
  {id: 'aachen-high-resolution-kemar', label: 'Aachen — High-Resolution KEMAR'},
];

export const DEFAULT_HRTF_PRESET: HrtfPreset = 'sadie-ii-d1-ku100';

/** Immutable release identity shared by the built-in .ojhrtf manifest and cache. */
export const HRTF_ASSET_VERSION = 'openjoc-hrtf-v2.0.0';

export type HrtfAssetMetadata = Readonly<{
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: string;
}>;

const HRTF_ASSET_METADATA: Readonly<Record<HrtfPreset, HrtfAssetMetadata>> = {
  'sadie-ii-d1-ku100': {
    fileName: 'sadie-ii-d1-ku100.ojhrtf',
    byteLength: 18_374_724,
    sha256: '78d048a68f84d34051578c262e401e35baa0e718901f85349afe0232f985d4df',
  },
  'sadie-ii-d2-kemar': {
    fileName: 'sadie-ii-d2-kemar.ojhrtf',
    byteLength: 18_374_724,
    sha256: 'b2f42ca2ce9ef2dfa7e3eff263543c4f306d0ac95bd684cf5ca344c88d6bd461',
  },
  'aachen-high-resolution-kemar': {
    fileName: 'aachen-high-resolution-kemar.ojhrtf',
    byteLength: 200_282_724,
    sha256: '2cc2f2d93194be681d4e446d66b4007060bc6c768cf7026c92e5efb87cf06dc3',
  },
};

export function hrtfAssetMetadata(preset: HrtfPreset): HrtfAssetMetadata {
  return HRTF_ASSET_METADATA[preset];
}

export function isHrtfPreset(value: unknown): value is HrtfPreset {
  return HRTF_PRESET_OPTIONS.some((option) => option.id === value);
}

export function normalizeHrtfPreset(value: unknown): HrtfPreset {
  return isHrtfPreset(value) ? value : DEFAULT_HRTF_PRESET;
}

export function hrtfPresetLabel(value: HrtfPreset): string {
  return HRTF_PRESET_OPTIONS.find((option) => option.id === value)?.label ?? 'SADIE II — KU100';
}
