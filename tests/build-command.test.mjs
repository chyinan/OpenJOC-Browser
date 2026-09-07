// pattern: Functional Core

import assert from 'node:assert/strict';
import test from 'node:test';
import {join} from 'node:path';

import {createTypeScriptCommand} from '../scripts/build-command.mjs';

test('keeps special characters in the browser path as an argument', () => {
  const browserRoot = 'C:\\build & review | marker';
  const nodeExecutable = 'C:\\Program Files\\nodejs\\node.exe';

  const command = createTypeScriptCommand(browserRoot, nodeExecutable);

  assert.equal(command.executable, nodeExecutable);
  assert.deepEqual(command.arguments, [
    join(browserRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p',
    join(browserRoot, 'tsconfig.json'),
  ]);
  assert.equal(command.arguments.includes('/c'), false);
});
