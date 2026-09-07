# Contributing

Thanks for contributing to OpenJOC-Browser. Please keep changes scoped to the browser integration and preserve the separation between page integration, transport parsing, OpenJOC WASM, and realtime audio.

## Before opening a pull request

```powershell
npm ci
npm run check:version
npm run check:release-policy
npm run check:wasm
npm run check
npm test
npm run test:lifecycle
npm run build
```

Run the parity commands when changing decoder integration, transport handling, timestamps, rendering selection, or generated package contents. Use the exact OpenJOC source pin unless the pull request explicitly updates the pin and includes the corresponding OpenJOC change.

## Pull requests

Describe the user-visible effect, affected extension contexts, tests run, and any browser/manual QA that remains. Do not include signed media URLs, account data, private media, browser profiles, generated QA directories, or secrets. Keep product scope aligned with [the current limitations](README.md#scope-and-limitations); feature requests for unsupported browsers or sites should explain the use case and security implications.

## Code and tests

Prefer small pure-core functions for parsing, validation, state transitions, and policy decisions. Keep browser APIs, storage, network, Worker, and AudioWorklet effects in thin imperative shells. Runtime messages must be schema-validated at the boundary and tied to the current tab, document, request, media key, and generation.
