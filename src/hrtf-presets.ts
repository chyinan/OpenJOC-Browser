// pattern: Functional Core

export type HrtfPreset = 'sadie-ii-d1-ku100' | 'sadie-ii-d2-kemar';

export type HrtfSelection = HrtfPreset | 'custom-sofa';

export type HrtfPresetOption = Readonly<{
  readonly id: HrtfPreset;
  readonly label: string;
}>;

export type HrtfSelectionOption = Readonly<{
  readonly id: HrtfSelection;
  readonly label: string;
}>;

export const HRTF_IMPORT_OPTION = {
  id: 'choose-custom-sofa',
  label: 'Custom SOFA…',
} as const;

export const HRTF_PRESET_OPTIONS: ReadonlyArray<HrtfPresetOption> = [
  {id: 'sadie-ii-d1-ku100', label: 'SADIE II — KU100'},
  {id: 'sadie-ii-d2-kemar', label: 'SADIE II — KEMAR'},
];

export const HRTF_SELECTION_OPTIONS: ReadonlyArray<HrtfSelectionOption> = [
  ...HRTF_PRESET_OPTIONS,
  {id: 'custom-sofa', label: 'Custom SOFA'},
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

export function isHrtfSelection(value: unknown): value is HrtfSelection {
  return HRTF_SELECTION_OPTIONS.some((option) => option.id === value);
}

export function normalizeHrtfSelection(value: unknown): HrtfSelection {
  return isHrtfSelection(value) ? value : DEFAULT_HRTF_PRESET;
}

export function hrtfPresetLabel(value: HrtfPreset): string {
  return HRTF_PRESET_OPTIONS.find((option) => option.id === value)?.label ?? 'SADIE II — KU100';
}

export function hrtfSelectionLabel(value: HrtfSelection): string {
  return HRTF_SELECTION_OPTIONS.find((option) => option.id === value)?.label ?? 'SADIE II — KU100';
}

export function hrtfRendererCacheKey(selection: HrtfSelection, revision: string | null): string {
  return selection === 'custom-sofa' ? `${selection}:${revision ?? 'missing'}` : selection;
}

export function resolveCustomSofaRevision(activeRevision: unknown, lastRevision: unknown): string | null {
  if (isSha256Revision(activeRevision)) return activeRevision;
  return isSha256Revision(lastRevision) ? lastRevision : null;
}

function isSha256Revision(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
