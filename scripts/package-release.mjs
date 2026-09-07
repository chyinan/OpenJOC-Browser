// pattern: Imperative Shell

import {createHash} from 'node:crypto';
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = join(browserRoot, 'extension');
const packageManifest = JSON.parse(readFileSync(join(browserRoot, 'package.json'), 'utf8'));
const extensionManifest = JSON.parse(readFileSync(join(extensionRoot, 'manifest.json'), 'utf8'));
const version = argumentValue('--version') ?? packageManifest.version;
const output = resolve(browserRoot, argumentValue('--output') ?? `release/OpenJOC-Browser-v${version}-chromium.zip`);

if (packageManifest.version !== version || extensionManifest.version !== version) {
  throw new Error(`release version mismatch: package=${packageManifest.version}, extension=${extensionManifest.version}, requested=${version}`);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`invalid release version: ${version}`);

const crcTable = Array.from({length: 256}, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

const files = [
  ...collectFiles(extensionRoot),
  {relativePath: 'LICENSE', bytes: normalizeTextBytes('LICENSE', readFileSync(join(browserRoot, 'LICENSE')))},
  {relativePath: 'THIRD_PARTY_NOTICES.txt', bytes: normalizeTextBytes('THIRD_PARTY_NOTICES.txt', readFileSync(join(browserRoot, 'THIRD_PARTY_NOTICES.md')))},
].sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
if (!files.some((file) => file.relativePath === 'manifest.json')) throw new Error('extension manifest is missing');
if (!files.some((file) => file.relativePath.toLowerCase().endsWith('.wasm'))) throw new Error('built WASM is missing from extension output');

const rootName = `OpenJOC-Browser-v${version}`;
const zip = createStoredZip(files, rootName);
mkdirSync(dirname(output), {recursive: true});
writeFileSync(output, zip);
const checksum = createHash('sha256').update(zip).digest('hex');
const checksumPath = `${output}.sha256`;
writeFileSync(checksumPath, `${checksum}  ${basename(output)}\n`);
console.log(`RELEASE_ARTIFACT=${relative(browserRoot, output).replaceAll('\\', '/')}`);
console.log(`CHECKSUM_FILE=${relative(browserRoot, checksumPath).replaceAll('\\', '/')}`);
console.log(`ZIP_SIZE=${zip.length}`);
console.log(`ZIP_SHA256=${checksum}`);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function collectFiles(root) {
  const result = [];
  walk(root, root, result);
  return result.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
}

function walk(root, current, result) {
  for (const entry of readdirSync(current, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    if (entry.name.startsWith('.') || entry.name.endsWith('.map')) continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) walk(root, path, result);
    else if (entry.isFile()) {
      const relativePath = relative(root, path).replaceAll('\\', '/');
      result.push({relativePath, bytes: normalizeTextBytes(relativePath, readFileSync(path))});
    }
  }
}

function normalizeTextBytes(relativePath, bytes) {
  if (relativePath !== 'LICENSE' && !/\.(?:html?|js|json|txt|md)$/i.test(relativePath)) return bytes;
  return Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n'), 'utf8');
}

function createStoredZip(files, rootName) {
  const localRecords = [];
  const centralRecords = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(`${rootName}/${file.relativePath}`, 'utf8');
    const crc = crc32(file.bytes);
    const localHeader = Buffer.alloc(30 + name.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(file.bytes.length, 18);
    localHeader.writeUInt32LE(file.bytes.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    name.copy(localHeader, 30);
    localRecords.push(Buffer.concat([localHeader, file.bytes]));

    const centralHeader = Buffer.alloc(46 + name.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(file.bytes.length, 20);
    centralHeader.writeUInt32LE(file.bytes.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    name.copy(centralHeader, 46);
    centralRecords.push(centralHeader);
    offset += localHeader.length + file.bytes.length;
  }
  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localRecords, centralDirectory, end]);
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
