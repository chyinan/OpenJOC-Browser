// pattern: Imperative Shell

import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createContentBundle} from './bundle-content.mjs';
import {createTypeScriptCommand} from './build-command.mjs';
import {validatePinnedHrtfAssetBaseUrl} from './hrtf-release-gate.mjs';
import {OPENJOC_SOURCE_PIN, resolveOpenjocRoot} from './openjoc-source.mjs';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const openjocRoot = await resolveOpenjocRoot();
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const hrtfAssetReleaseTag = 'openjoc-hrtf-v2.0.0';
const hrtfPackageKind = argumentValue('--hrtf-package') ?? process.env.OPENJOC_HRTF_PACKAGE ?? 'standard';
const hrtfAssetBaseUrl = validatePinnedHrtfAssetBaseUrl(
  process.env.OPENJOC_HRTF_ASSET_BASE_URL
    ?? `https://github.com/chyinan/OpenJOC/releases/download/${hrtfAssetReleaseTag}/`,
  hrtfAssetReleaseTag,
);
if (hrtfPackageKind !== 'standard' && hrtfPackageKind !== 'full') {
  throw new Error(`invalid HRTF package kind: ${hrtfPackageKind}`);
}

function run(command, arguments_, cwd) {
  const result = spawnSync(command, arguments_, {cwd, stdio: 'inherit'});
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function rustAssetMetadata(sourceRoot, presetId) {
  const source = readFileSync(join(sourceRoot, 'crates', 'openjoc-sofa', 'src', 'builtin_hrtf.rs'), 'utf8');
  const start = source.indexOf(`id: "${presetId}"`);
  const end = start < 0 ? -1 : source.indexOf('\n            },', start);
  const assetStart = source.indexOf(`preset_id: "${presetId}"`);
  const assetEnd = assetStart < 0 ? -1 : source.indexOf('\n            },', assetStart);
  if (start < 0 || end < 0 || assetStart < 0 || assetEnd < 0) {
    throw new Error(`OpenJOC HRTF registry entry is missing: ${presetId}`);
  }
  const entry = source.slice(start, end);
  const assetEntry = source.slice(assetStart, assetEnd);
  const fileName = assetEntry.match(/asset_file:\s*"([^"]+)"/)?.[1];
  const byteLengthText = assetEntry.match(/asset_size_bytes:\s*([0-9_]+)/)?.[1];
  const sha256 = assetEntry.match(/asset_sha256:\s*"([0-9a-f]{64})"/)?.[1];
  const dataset = entry.match(/dataset:\s*"([^"]+)"/)?.[1];
  const sourceUrl = entry.match(/source:\s*"([^"]+)"/)?.[1];
  const authorsInstitution = assetEntry.match(/authors_institution:\s*"([^"]+)"/)?.[1];
  const doi = entry.match(/doi:\s*Some\("([^"]+)"\)/)?.[1] ?? null;
  const license = entry.match(/license:\s*"([^"]+)"/)?.[1];
  const sampleRateText = entry.match(/sample_rate_hz:\s*([0-9_]+)/)?.[1];
  const directionCountText = assetEntry.match(/asset_direction_count:\s*([0-9_]+)/)?.[1];
  const tapCountText = entry.match(/ir_length:\s*([0-9_]+)/)?.[1];
  const notes = entry.match(/notes:\s*"([^"]+)"/)?.[1];
  if (fileName === undefined || byteLengthText === undefined || sha256 === undefined) {
    throw new Error(`OpenJOC HRTF asset metadata is incomplete: ${presetId}`);
  }
  if (dataset === undefined || sourceUrl === undefined || authorsInstitution === undefined
    || license === undefined || sampleRateText === undefined || directionCountText === undefined
    || tapCountText === undefined || notes === undefined) {
    throw new Error(`OpenJOC HRTF provenance metadata is incomplete: ${presetId}`);
  }
  return {
    fileName,
    byteLength: Number(byteLengthText.replaceAll('_', '')),
    sha256,
    dataset,
    source: sourceUrl,
    authorsInstitution,
    doi,
    license,
    sampleRateHz: Number(sampleRateText.replaceAll('_', '')),
    directionCount: Number(directionCountText.replaceAll('_', '')),
    tapCount: Number(tapCountText.replaceAll('_', '')),
    notes,
  };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function rustRegistryIds(sourceRoot) {
  const source = readFileSync(join(sourceRoot, 'crates', 'openjoc-sofa', 'src', 'builtin_hrtf.rs'), 'utf8');
  const registry = source.match(/pub const BUILTIN_HRTF_REGISTRY:\s*\[BuiltinHrtf;\s*\d+\]\s*=\s*\[([\s\S]*?)\];/)?.[1];
  if (registry === undefined) throw new Error('OpenJOC built-in HRTF registry declaration is missing');
  const idsByVariant = new Map([...source.matchAll(/Self::([A-Za-z0-9_]+)\s*=>\s*"([a-z0-9-]+)"/g)]
    .map((match) => [match[1], match[2]]));
  return [...registry.matchAll(/BuiltinHrtf::([A-Za-z0-9_]+)/g)]
    .map((match) => {
      const id = idsByVariant.get(match[1]);
      if (id === undefined) throw new Error(`OpenJOC preset ID is missing for ${match[1]}`);
      return id;
    })
    .sort();
}

function assertExternalHrtfAssetSupport(sourceRoot) {
  const wasmCargo = readFileSync(join(sourceRoot, 'crates', 'openjoc-wasm', 'Cargo.toml'), 'utf8');
  const wasmFfi = readFileSync(join(sourceRoot, 'crates', 'openjoc-wasm', 'src', 'ffi.rs'), 'utf8');
  if (!/^\s*external-builtin-hrtf-assets\s*=/m.test(wasmCargo)
    || !wasmFfi.includes('openjoc_wasm_decoder_create_with_renderer_and_hrtf_asset')) {
    throw new Error('resolved OpenJOC source lacks the external HRTF asset ABI; set OPENJOC_ROOT or OPENJOC_SOURCE_PIN to a compatible commit');
  }
}

assertExternalHrtfAssetSupport(openjocRoot);

run(cargo, [
  'build',
  '--manifest-path', join(openjocRoot, 'Cargo.toml'),
  '-p', 'openjoc-wasm',
  '--target', 'wasm32-unknown-unknown',
  '--release',
  '--no-default-features',
  '--features', 'external-builtin-hrtf-assets',
  '--locked',
], openjocRoot);
const typeScriptCommand = createTypeScriptCommand(browserRoot, process.execPath);
run(typeScriptCommand.executable, typeScriptCommand.arguments, browserRoot);
const {HRTF_ASSET_VERSION, HRTF_PRESET_OPTIONS, hrtfAssetMetadata} = await import(new URL('../extension/hrtf-presets.js', import.meta.url));
if (HRTF_ASSET_VERSION !== hrtfAssetReleaseTag) throw new Error('HRTF asset tag does not match the compiled preset registry');

writeFileSync(join(browserRoot, 'extension', 'bilibili-content.bundle.js'), createContentBundle(join(browserRoot, 'extension')));

const wasmOutput = join(browserRoot, 'extension', 'wasm');
mkdirSync(wasmOutput, {recursive: true});
copyFileSync(
  join(openjocRoot, 'target', 'wasm32-unknown-unknown', 'release', 'openjoc_wasm.wasm'),
  join(wasmOutput, 'openjoc_wasm.wasm'),
);

const hrtfSource = join(openjocRoot, 'crates', 'openjoc-sofa', 'assets');
const hrtfOutput = join(wasmOutput, 'hrtf');
mkdirSync(hrtfOutput, {recursive: true});
const sourceHrtfAssets = readdirSync(hrtfSource).filter((name) => name.endsWith('.ojhrtf')).sort();
const rustPresetIds = rustRegistryIds(openjocRoot);
const browserPresetIds = HRTF_PRESET_OPTIONS.map((preset) => preset.id).sort();
if (JSON.stringify(rustPresetIds) !== JSON.stringify(browserPresetIds)) {
  throw new Error(`OpenJOC and Browser HRTF preset IDs disagree: ${rustPresetIds.join(', ')}`);
}
const registryAssets = HRTF_PRESET_OPTIONS
  .map((preset) => {
    const browserMetadata = hrtfAssetMetadata(preset.id);
    const rustMetadata = rustAssetMetadata(openjocRoot, preset.id);
    if (browserMetadata.fileName !== rustMetadata.fileName
      || browserMetadata.byteLength !== rustMetadata.byteLength
      || browserMetadata.sha256 !== rustMetadata.sha256) {
      throw new Error(`OpenJOC and Browser HRTF registries disagree for ${preset.id}`);
    }
    return {presetId: preset.id, ...browserMetadata, ...rustMetadata};
  })
  .sort((left, right) => left.fileName.localeCompare(right.fileName));
const registryNames = registryAssets.map((asset) => asset.fileName);
if (JSON.stringify(sourceHrtfAssets) !== JSON.stringify(registryNames)) {
  throw new Error(`built-in HRTF source files do not match the preset registry: ${sourceHrtfAssets.join(', ')}`);
}
const bundledPresetIds = hrtfPackageKind === 'full'
  ? HRTF_PRESET_OPTIONS.map((preset) => preset.id)
  : ['sadie-ii-d1-ku100'];
const bundledAssets = registryAssets.filter((asset) => bundledPresetIds.includes(asset.presetId));
const bundledAssetNames = bundledAssets.map((asset) => asset.fileName).sort();
const expectedAssetNames = new Set(bundledAssetNames);
for (const existingAsset of readdirSync(hrtfOutput)) {
  if (existingAsset.endsWith('.ojhrtf') && !expectedAssetNames.has(existingAsset)) {
    rmSync(join(hrtfOutput, existingAsset), {force: true});
  }
}
for (const metadata of registryAssets) {
  const sourcePath = join(hrtfSource, metadata.fileName);
  const bytes = readFileSync(sourcePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== metadata.byteLength || sha256 !== metadata.sha256) {
    throw new Error(`built-in HRTF asset failed registry integrity check: ${metadata.fileName}`);
  }
  if (expectedAssetNames.has(metadata.fileName)) {
    copyFileSync(sourcePath, join(hrtfOutput, metadata.fileName));
  }
}
const hrtfManifest = {
  schemaVersion: 1,
  assetVersion: HRTF_ASSET_VERSION,
  packageKind: hrtfPackageKind,
  baseUrl: hrtfAssetBaseUrl.href,
  bundledPresets: bundledPresetIds,
  assets: Object.fromEntries(registryAssets.map((asset) => [asset.presetId, {
    presetId: asset.presetId,
    assetVersion: HRTF_ASSET_VERSION,
    fileName: asset.fileName,
    byteLength: asset.byteLength,
    sha256: asset.sha256,
    url: new URL(asset.fileName, hrtfAssetBaseUrl).href,
    dataset: asset.dataset,
    source: asset.source,
    authorsInstitution: asset.authorsInstitution,
    doi: asset.doi,
    license: asset.license,
    sampleRateHz: asset.sampleRateHz,
    directionCount: asset.directionCount,
    tapCount: asset.tapCount,
    notes: asset.notes,
  }])),
};
writeFileSync(join(hrtfOutput, 'manifest.json'), `${JSON.stringify(hrtfManifest, null, 2)}\n`);

const sourceGitRootResult = spawnSync('git', ['-C', openjocRoot, 'rev-parse', '--show-toplevel'], {encoding: 'utf8'});
const sourceIsGitCheckout = sourceGitRootResult.status === 0
  && resolve(sourceGitRootResult.stdout.trim()) === resolve(openjocRoot);
const sourceHasGitMetadata = existsSync(join(openjocRoot, '.git'));
if (sourceGitRootResult.status === 0 && sourceHasGitMetadata && !sourceIsGitCheckout) {
  throw new Error('OpenJOC source path contains Git metadata but is not the Git repository root');
}
const sourceCommitResult = sourceIsGitCheckout
  ? spawnSync('git', ['-C', openjocRoot, 'rev-parse', 'HEAD'], {encoding: 'utf8'})
  : null;
const sourceStatusResult = sourceIsGitCheckout
  ? spawnSync('git', ['-C', openjocRoot, 'status', '--porcelain'], {encoding: 'utf8'})
  : null;
const sourceArchivePinPath = join(openjocRoot, '.openjoc-source-pin');
const sourceArchivePin = existsSync(sourceArchivePinPath)
  ? readFileSync(sourceArchivePinPath, 'utf8').trim()
  : null;
if (!sourceIsGitCheckout && (OPENJOC_SOURCE_PIN === null || sourceArchivePin !== OPENJOC_SOURCE_PIN)) {
  throw new Error(`OpenJOC source archive pin mismatch: expected ${OPENJOC_SOURCE_PIN}, found ${sourceArchivePin ?? 'missing'}`);
}
writeFileSync(join(wasmOutput, 'openjoc-build-info.json'), `${JSON.stringify({
  sourceCommit: sourceCommitResult?.status === 0 ? sourceCommitResult.stdout.trim() : sourceArchivePin,
  sourceDirty: sourceStatusResult?.status === 0 ? sourceStatusResult.stdout.trim().length > 0 : null,
  sourceIsArchive: !sourceIsGitCheckout && sourceArchivePin !== null,
  hrtfPackage: hrtfPackageKind,
  hrtfAssets: bundledAssetNames,
  hrtfEmbedding: false,
}, null, 2)}\n`);
