# Development

## Toolchain

- Node.js `24.15.0`, recorded in `.nvmrc` and constrained by `package.json` engines.
- npm with the committed `package-lock.json`; use `npm ci`.
- Rust `1.85` or newer with the `wasm32-unknown-unknown` target.
- Git, because the build resolves the pinned OpenJOC source repository.

The Browser build uses OpenJOC commit `e123aa3a0e2878587c73130585a5606db4ff233f` from `https://github.com/chyinan/OpenJOC.git`. Without `OPENJOC_ROOT`, the resolver shallow-clones the public `codex/openjoc-wasm-bridge` ref into ignored `.cache/openjoc/<commit>/`, checks out the exact commit, and verifies `HEAD` before invoking Cargo. If Git transport is unavailable, it falls back to the GitHub codeload archive URL for that same commit and verifies an exact pin marker. The branch is only a fetch aid; the build never compiles an unpinned checkout.

For a local checkout, set `OPENJOC_ROOT` to a working tree at that exact commit. The resolver rejects another branch or commit. This override is for development and offline validation; a fresh clone does not require it.

## Install and gates

```powershell
npm ci
npm run check:version
npm run check:release-policy
npm run check:wasm
npm run check
npm test
npm run test:lifecycle
```

`npm test` compiles the TypeScript test set and runs the functional-core suites. `npm run test:lifecycle` runs the source-level content, service-worker, offscreen, Worker, AudioWorklet, media bridge, range-fetch, preference, and player-control integration harnesses sequentially.

## Build and parity

```powershell
npm run build
npm run parity
npm run cmaf-parity
npm run parity -- fixtures/joc.lifecycle.ec3 --binaural
npm run cmaf-parity -- --binaural
```

`npm run build` builds the pinned `openjoc-wasm` crate for `wasm32-unknown-unknown`, compiles TypeScript into ignored `extension/*.js`, bundles the classic Bilibili content script, and copies the WASM into ignored `extension/wasm/`. `npm run parity` requires bit-identical native-vs-WASM PCM; `npm run cmaf-parity` requires bit-identical raw-vs-CMAF PCM.

## Package and validate

```powershell
npm run package:release -- --version 0.1.0
npm run validate:release -- --version 0.1.0
```

The package script creates one `OpenJOC-Browser-v0.1.0-chromium.zip` with a directly loadable top-level directory, `LICENSE`, and `THIRD_PARTY_NOTICES.txt`. It also writes a sibling `.sha256` file. The validator parses and unpacks the stored ZIP, checks the manifest references, verifies the WASM and notices, rejects development junk, and checks the checksum.

## Local browser QA

Edge:

```powershell
.\scripts\launch-edge.ps1 -Port 9229
node scripts/cdp-qa.mjs 9229 Edge <extension-id>
node scripts/cdp-bilibili-qa.mjs 9229 Edge
```

Chrome uses `scripts/launch-chrome.ps1` with a different port. The CDP fixture smoke covers the packaged runtime's local player path, including normal playback, pause/resume, reset, malformed input, and optional Binaural diagnostics. A live Bilibili JOC smoke additionally requires a session that actually receives an entitled JOC representation.

## Source maps and generated output

Source maps are excluded from the first release. The source repository is public and the package is intended to be a loadable runtime artifact; shipping unneeded maps would increase the package without adding a supported debugging surface. Generated JavaScript, WASM, test output, QA profiles, parity output, caches, and release archives are ignored and must be recreated by the documented commands.
