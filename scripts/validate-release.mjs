// pattern: Imperative Shell

import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = (argumentValue('--version') ?? '0.1.0').replace(/^v/, '');
const zipPath = resolve(browserRoot, argumentValue('--zip') ?? `release/OpenJOC-Browser-v${version}-chromium.zip`);
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
