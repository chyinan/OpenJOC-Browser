// pattern: Imperative Shell

import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {validatePinnedHrtfAssetBaseUrl} from './hrtf-release-gate.mjs';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = JSON.parse(readFileSync(join(browserRoot, 'package.json'), 'utf8')).version;
const version = (argumentValue('--version') ?? packageVersion).replace(/^v/, '');
const requestedHrtfPackage = argumentValue('--hrtf-package');
const zipPath = resolve(browserRoot, argumentValue('--zip') ?? `release/OpenJOC-Browser-v${version}-chromium-${requestedHrtfPackage ?? 'standard'}.zip`);
const {HRTF_ASSET_VERSION, HRTF_PRESET_OPTIONS, hrtfAssetMetadata} = await import(new URL('../extension/hrtf-presets.js', import.meta.url));
if (!existsSync(zipPath)) throw new Error(`release ZIP is missing: ${zipPath}`);

const zipBytes = readFileSync(zipPath);
const entries = readStoredZip(zipBytes);
const rootNames = new Set([...entries.keys()].map((name) => name.split('/')[0]));
const rootName = `OpenJOC-Browser-v${version}`;
if (rootNames.size !== 1 || !rootNames.has(rootName)) throw new Error(`release ZIP root must be ${rootName}/`);
const manifestEntry = `${rootName}/manifest.json`;
const manifestBytes = entries.get(manifestEntry);
if (manifestBytes === undefined) throw new Error('release ZIP manifest is missing');
if (!entries.has(`${rootName}/LICENSE`) || !entries.has(`${rootName}/THIRD_PARTY_NOTICES.txt`)) throw new Error('release ZIP license or third-party notices are missing');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.manifest_version !== 3 || manifest.version !== version) throw new Error('release ZIP manifest version or format is invalid');
validateHrtfPackage(entries, rootName, requestedHrtfPackage, {HRTF_ASSET_VERSION, HRTF_PRESET_OPTIONS, hrtfAssetMetadata});

const forbidden = /(?:\.map$|\.ts$|\.tsx$|node_modules|\.git(?:\/|$)|(?:^|\/)target(?:\/|$)|(?:^|\/)\.qa(?:\/|$)|(?:^|\/)artifacts?(?:\/|$)|(?:^|\/)\.env|\.pem$|\.key$|(?:^|\/)PROGRESS-)/i;
for (const name of entries.keys()) {
  if (name.startsWith(`${rootName}/`) === false || forbidden.test(name)) throw new Error(`release ZIP contains forbidden entry: ${name}`);
}

const requiredPaths = [
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((script) => script.js ?? []),
  manifest.offscreen_documents?.matches === undefined ? 'offscreen.html' : null,
].filter((value) => typeof value === 'string');
for (const path of requiredPaths) {
  if (!entries.has(`${rootName}/${path}`)) throw new Error(`manifest references missing release entry: ${path}`);
}
const wasmEntries = [...entries.keys()].filter((name) => name.toLowerCase().endsWith('.wasm'));
if (wasmEntries.length !== 1) throw new Error(`release ZIP must contain exactly one WASM file, found ${wasmEntries.length}`);
for (const iconPath of iconPaths(manifest)) {
  if (!entries.has(`${rootName}/${iconPath}`)) throw new Error(`manifest references missing icon: ${iconPath}`);
}

const extractedRoot = mkdtempSync(join(tmpdir(), 'openjoc-release-'));
try {
  for (const [name, bytes] of entries) {
    const relativePath = name.slice(`${rootName}/`.length);
    const output = join(extractedRoot, relativePath);
    mkdirSync(dirname(output), {recursive: true});
    writeFileSync(output, bytes);
  }
  const extractedManifest = JSON.parse(readFileSync(join(extractedRoot, 'manifest.json'), 'utf8'));
  if (extractedManifest.version !== version || readFileSync(join(extractedRoot, wasmEntries[0].slice(`${rootName}/`.length))).length === 0) {
    throw new Error('unpacked release validation failed');
  }
} finally {
  rmSync(extractedRoot, {recursive: true, force: true});
}

const checksumPath = `${zipPath}.sha256`;
if (!existsSync(checksumPath)) throw new Error(`checksum file is missing: ${checksumPath}`);
const checksum = createHash('sha256').update(zipBytes).digest('hex');
const expectedChecksum = readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0];
if (expectedChecksum !== checksum) throw new Error(`checksum mismatch: expected ${expectedChecksum}, actual ${checksum}`);
console.log(`RELEASE_PACKAGE=PASS entries=${entries.size} wasm=${wasmEntries[0]} zip_bytes=${zipBytes.length}`);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function validateHrtfPackage(entries, rootName, requestedKind, registry) {
  const manifestPath = `${rootName}/wasm/hrtf/manifest.json`;
  const bytes = entries.get(manifestPath);
  if (bytes === undefined) throw new Error('built-in HRTF asset manifest is missing from the package');
  const hrtfManifest = JSON.parse(bytes.toString('utf8'));
  const packageKind = hrtfManifest.packageKind;
  if ((packageKind !== 'standard' && packageKind !== 'full') || (requestedKind !== undefined && requestedKind !== packageKind)) {
    throw new Error(`HRTF package mode mismatch: requested=${requestedKind}, found=${packageKind}`);
  }
  if (hrtfManifest.schemaVersion !== 1 || hrtfManifest.assetVersion !== registry.HRTF_ASSET_VERSION) {
    throw new Error('built-in HRTF asset manifest version is invalid');
  }
  if (!Array.isArray(hrtfManifest.bundledPresets) || hrtfManifest.assets === null || typeof hrtfManifest.assets !== 'object') {
    throw new Error('built-in HRTF asset manifest table is invalid');
  }
  const presetIds = registry.HRTF_PRESET_OPTIONS.map((preset) => preset.id).toSorted();
  const expectedBundled = packageKind === 'full' ? presetIds : ['sadie-ii-d1-ku100'];
  if (JSON.stringify(hrtfManifest.bundledPresets.toSorted()) !== JSON.stringify(expectedBundled)) {
    throw new Error(`${packageKind} package has an invalid bundled HRTF preset set`);
  }
  const baseUrl = validatePinnedHrtfAssetBaseUrl(hrtfManifest.baseUrl, registry.HRTF_ASSET_VERSION);

  const packagedHrtfFiles = [];
  for (const preset of registry.HRTF_PRESET_OPTIONS) {
    const metadata = registry.hrtfAssetMetadata(preset.id);
    const asset = hrtfManifest.assets?.[preset.id];
    if (asset === undefined
      || asset.presetId !== preset.id
      || asset.assetVersion !== registry.HRTF_ASSET_VERSION
      || asset.fileName !== metadata.fileName
      || asset.byteLength !== metadata.byteLength
      || asset.sha256 !== metadata.sha256
      || asset.url !== new URL(metadata.fileName, baseUrl).href
      || typeof asset.dataset !== 'string'
      || typeof asset.source !== 'string'
      || typeof asset.license !== 'string'
      || typeof asset.authorsInstitution !== 'string') {
      throw new Error(`built-in HRTF metadata or immutable URL mismatch: ${preset.id}`);
    }
    const packagedPath = `${rootName}/wasm/hrtf/${metadata.fileName}`;
    const packagedAsset = entries.get(packagedPath);
    if (expectedBundled.includes(preset.id)) {
      if (packagedAsset === undefined || packagedAsset.length !== metadata.byteLength) {
        throw new Error(`bundled HRTF file is missing or has the wrong size: ${preset.id}`);
      }
      const sha256 = createHash('sha256').update(packagedAsset).digest('hex');
      if (sha256 !== metadata.sha256) throw new Error(`bundled HRTF checksum mismatch: ${preset.id}`);
      packagedHrtfFiles.push(packagedPath);
    } else if (packagedAsset !== undefined) {
      throw new Error(`standard HRTF package unexpectedly includes ${preset.id}`);
    }
  }
  const actualHrtfFiles = [...entries.keys()]
    .filter((name) => name.startsWith(`${rootName}/wasm/hrtf/`) && name.endsWith('.ojhrtf'))
    .toSorted();
  if (JSON.stringify(actualHrtfFiles) !== JSON.stringify(packagedHrtfFiles.toSorted())) {
    throw new Error('release ZIP contains an unexpected .ojhrtf asset');
  }
}

function iconPaths(manifest) {
  const paths = [];
  for (const icons of [manifest.icons, manifest.action?.default_icon]) {
    if (icons !== null && typeof icons === 'object') paths.push(...Object.values(icons).filter((value) => typeof value === 'string'));
  }
  return paths;
}

function readStoredZip(bytes) {
  const endOffset = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) throw new Error('ZIP end record is missing');
  const count = bytes.readUInt16LE(endOffset + 10);
  const centralSize = bytes.readUInt32LE(endOffset + 12);
  const centralOffset = bytes.readUInt32LE(endOffset + 16);
  if (centralOffset + centralSize > endOffset) throw new Error('ZIP central directory is invalid');
  const entries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP central entry is invalid');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString((flags & 0x0800) !== 0 ? 'utf8' : 'ascii');
    if (method !== 0 || compressedSize !== uncompressedSize) throw new Error(`ZIP entry is not stored: ${name}`);
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP local entry is invalid: ${name}`);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = Buffer.from(bytes.subarray(start, start + uncompressedSize));
    entries.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
