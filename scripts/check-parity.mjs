// pattern: Imperative Shell

import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const browserRoot = fileURLToPath(new URL('..', import.meta.url));
for (const renderer of ['stereo', 'binaural']) {
  for (const dialnorm of ['calibrated', 'unity']) {
    const flags = [...(renderer === 'binaural' ? ['--binaural'] : []), ...(dialnorm === 'unity' ? ['--unity'] : [])];
    for (const [script, arguments_] of [
      ['wasm-parity.mjs', ['fixtures/joc.lifecycle.ec3', ...flags]],
      ['cmaf-parity.mjs', flags],
    ]) {
      console.log(`PARITY_CASE=${script} renderer=${renderer} dialnorm=${dialnorm}`);
      const result = spawnSync(process.execPath, [`scripts/${script}`, ...arguments_], {cwd: browserRoot, stdio: 'inherit'});
      if (result.error !== undefined) throw result.error;
      if (result.status !== 0) process.exit(result.status ?? 1);
    }
  }
}
