// pattern: Functional Core

import {join} from 'node:path';

export function createTypeScriptCommand(browserRoot, nodeExecutable) {
  return {
    executable: nodeExecutable,
    arguments: [
      join(browserRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      join(browserRoot, 'tsconfig.json'),
    ],
  };
}
