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

`npm run build` creates the single Standard package. It copies both `.ojhrtf` files from the selected OpenJOC source tree, checks their byte lengths and SHA-256 values against the registries, and records both as bundled. The manifest validator rejects any package that marks a supported preset as download-only. HRTF selection therefore works offline and does not contact an asset host.

`npm run parity` requires bit-identical native-vs-WASM PCM; `npm run cmaf-parity` requires bit-identical raw-vs-CMAF PCM.

## Package and validate

```powershell
npm run build
npm run package:release -- --version 0.1.0
npm run validate:release -- --version 0.1.0
```

The package script creates `OpenJOC-Browser-v0.1.0-chromium-standard.zip` with a directly loadable top-level directory, `LICENSE`, `THIRD_PARTY_NOTICES.txt`, the WASM renderer, and both HRTF assets. It writes a sibling `.sha256` file. The validator checks that every supported preset is bundled, verifies both byte lengths and SHA-256 values, checks manifest references and notices, and verifies the ZIP checksum.

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
