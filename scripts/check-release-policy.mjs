// pattern: Imperative Shell

import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const browserRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync('git', ['ls-files', '-z'], {cwd: browserRoot});
if (result.error !== undefined) throw result.error;
if (result.status !== 0) throw new Error('failed to enumerate tracked files');
const files = result.stdout.toString('utf8').split('\0').filter(Boolean);
const localPathPattern = /(?:[A-Za-z]:[\\/](?:Programs|Users|Documents|src)[\\/]|\\\\(?:localhost|127\.0\.0\.1)\\)/;
const offenders = [];
for (const file of files) {
  const path = resolve(browserRoot, file);
  if (!existsSync(path)) continue;
  const bytes = readFileSync(path);
  if (bytes.includes(0)) continue;
  const content = bytes.toString('utf8');
  if (localPathPattern.test(content)) offenders.push(file);
}
if (offenders.length > 0) {
  throw new Error(`tracked absolute local paths found in: ${offenders.join(', ')}`);
}
console.log(`LOCAL_PATH_POLICY=PASS files=${files.length}`);
