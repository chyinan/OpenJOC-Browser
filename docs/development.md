# Development

## Toolchain

- Node.js `24.15.0`, recorded in `.nvmrc` and constrained by `package.json` engines.
- npm with the committed `package-lock.json`; use `npm ci`.
- Rust `1.85` or newer with the `wasm32-unknown-unknown` target.
- Git, to record the OpenJOC revision used by the build.

For coordinated local development, the build prefers a neighboring `OpenJOC` checkout; `OPENJOC_ROOT` can explicitly select any local source tree with `Cargo.toml`. The generated `extension/wasm/openjoc-build-info.json` records the source commit and whether the Git tree is dirty. This lets the Browser use the active OpenJOC source rather than rejecting it for not matching an older pin.

When no neighboring or explicitly selected checkout exists, the resolver checks out the configured public source ref (default `master`). Set `OPENJOC_SOURCE_PIN` to a full 40-hex commit SHA to build from one exact commit; path-like or abbreviated pins are rejected. Pinned archives are used only when Git transport is unavailable and a valid pin was supplied. Release artifacts record the resolved commit and dirty state. The selected OpenJOC revision must contain the external-HRTF asset ABI and `external-builtin-hrtf-assets` feature; until those changes are present on the public ref, use `OPENJOC_ROOT` or `OPENJOC_SOURCE_PIN` to select the compatible clean source snapshot.

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

`npm run build` produces the Standard package: the WASM renderer, generated built-in manifest, and D1 only. D2 and Aachen remain selectable, but are downloaded from the pinned HTTPS GitHub Release URL when selected, after which the canonical `.ojhrtf` is verified and cached in extension Cache Storage. `npm run build:full` produces a Full offline package with the same three `.ojhrtf` assets and SHA-256 values. The build validates all source asset hashes in either mode and removes stale assets from the other package mode. The asset URL is fixed to the OpenJOC HRTF release path; the manifest loader rejects a different GitHub owner or repository.

`npm run parity` requires bit-identical native-vs-WASM PCM; `npm run cmaf-parity` requires bit-identical raw-vs-CMAF PCM.

## Package and validate

```powershell
npm run build
npm run package:release -- --version 0.1.0
npm run validate:release -- --version 0.1.0 --hrtf-package standard
npm run build:full
npm run package:full -- --version 0.1.0
npm run validate:release -- --version 0.1.0 --hrtf-package full
```

The package scripts create `OpenJOC-Browser-v0.1.0-chromium-standard.zip` and `OpenJOC-Browser-v0.1.0-chromium-full.zip`, each with a directly loadable top-level directory, `LICENSE`, and `THIRD_PARTY_NOTICES.txt`. Each writes a sibling `.sha256` file. The validator checks package mode, bundled asset list, all declared byte lengths and SHA-256 values, manifest references, WASM/notices, and the ZIP checksum.

Before publishing a Browser release, upload `sadie-ii-d2-kemar.ojhrtf` and `aachen-high-resolution-kemar.ojhrtf` from the verified OpenJOC source assets to the immutable `openjoc-hrtf-v2.0.0` GitHub Release. The remote asset release is separate from the Browser ZIP release. The release workflow runs `npm run check:hrtf-assets-remote`, which streams both remote files and blocks packaging if either response, byte length, or SHA-256 differs from the local registry.

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
