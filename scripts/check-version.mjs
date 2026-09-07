// pattern: Imperative Shell

import {readFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expected = (process.argv[2] ?? '0.1.0').replace(/^v/, '');
const packageManifest = JSON.parse(readFileSync(resolve(browserRoot, 'package.json'), 'utf8'));
const extensionManifest = JSON.parse(readFileSync(resolve(browserRoot, 'extension', 'manifest.json'), 'utf8'));
const actual = {package: packageManifest.version, extension: extensionManifest.version};
if (actual.package !== expected || actual.extension !== expected) {
  throw new Error(`version mismatch: expected ${expected}, package=${actual.package}, extension=${actual.extension}`);
}
console.log(`VERSION=PASS ${expected}`);
