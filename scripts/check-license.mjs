// pattern: Imperative Shell

import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const licensePath = resolve(browserRoot, 'LICENSE');
const noticesPath = resolve(browserRoot, 'THIRD_PARTY_NOTICES.md');
if (!existsSync(licensePath) || !existsSync(noticesPath)) throw new Error('LICENSE or THIRD_PARTY_NOTICES.md is missing');
const license = readFileSync(licensePath, 'utf8');
const notices = readFileSync(noticesPath, 'utf8');
for (const phrase of ['Apache License', 'Version 2.0', 'END OF TERMS AND CONDITIONS']) {
  if (!license.includes(phrase)) throw new Error(`LICENSE is incomplete: missing ${phrase}`);
}
for (const phrase of ['OpenJOC', 'SADIE II', 'University of York', 'Apache License']) {
  if (!notices.includes(phrase)) throw new Error(`third-party notice is incomplete: missing ${phrase}`);
}
console.log('LICENSE_CHECK=PASS Apache-2.0');
