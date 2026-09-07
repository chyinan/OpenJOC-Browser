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
const secretPattern = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp|github_pat|glpat|sk_live|AKIA)[A-Za-z0-9_\-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})/;
const offenders = [];
for (const file of files) {
  const path = resolve(browserRoot, file);
  if (!existsSync(path)) continue;
  const bytes = readFileSync(path);
  if (bytes.includes(0)) continue;
  if (secretPattern.test(bytes.toString('utf8'))) offenders.push(file);
}
if (offenders.length > 0) throw new Error(`possible secret material found in: ${offenders.join(', ')}`);
console.log(`SECRET_SCAN=PASS files=${files.length}`);
