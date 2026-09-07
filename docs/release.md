# Release engineering

## v0.1.0 release shape

The official artifact is one Chromium ZIP:

`OpenJOC-Browser-v0.1.0-chromium.zip`

Edge and Chrome use the same Manifest V3 output. The ZIP expands to:

```text
OpenJOC-Browser-v0.1.0/
  manifest.json
  service-worker.js
  offscreen.html
  offscreen.js
  bilibili-content.bundle.js
  bilibili-main-bridge.js
  bilibili-audio-controls.js
  icons/icon-16.png
  icons/icon-32.png
  icons/icon-48.png
  icons/icon-128.png
  wasm/openjoc_wasm.wasm
  LICENSE
  THIRD_PARTY_NOTICES.txt
```

The package script includes all built runtime files under `extension/`, excludes source maps and hidden files, uses stable file ordering and fixed ZIP metadata, and writes a SHA-256 checksum next to the artifact. The first-release source-map policy is `EXCLUDE`.

## Release workflow

`.github/workflows/release.yml` runs only for a `v*.*.*` tag. It checks that the tag version equals `package.json` and `extension/manifest.json`, installs dependencies with `npm ci`, resolves OpenJOC at the declared commit, runs checks/tests, builds WASM from source, packages the extension, validates the ZIP and checksum, and creates a draft GitHub Release with the ZIP and checksum attached. The source resolver may use the exact-commit GitHub archive only when Git transport is unavailable; it still validates the same source pin.

The workflow has `contents: write` only because creating a GitHub Release requires it. It does not publish to Chrome Web Store or Microsoft Edge Add-ons. A tag is not created by the repository scripts.

## Local dry run

```powershell
npm ci
npm run check:version -- v0.1.0
npm run check:release-policy
npm run check:wasm
npm run check
npm test
npm run test:lifecycle
npm run build
npm run parity
npm run cmaf-parity
npm run package:release -- --version 0.1.0
npm run validate:release -- --version 0.1.0
```

This is the local equivalent of the release job. It does not create a Git tag or GitHub Release.

## Manifest review

The v0.1.0 manifest review is PASS:

- `activeTab` is used by the user-initiated toolbar toggle.
- `offscreen` is used for the hidden audio document.
- `storage` is used for local playback preferences.
- `https://bilivideo.com/*` and `https://*.bilivideo.com/*` are used for bounded selected-media range requests.
- Content scripts match only standard Bilibili VOD URLs.
- There is no `all_urls`, `web_accessible_resources`, `externally_connectable`, cookie permission, or broad arbitrary-fetch permission.
- `wasm-unsafe-eval` is limited to extension pages because WebAssembly instantiation needs it; no remote JavaScript or remote WASM is loaded.

## Human gates

After automated gates pass, use the exact ZIP from `release/` for one Edge and one Chrome load test where those browsers are available. On a Bilibili session with an entitled JOC representation, verify detection, enable, audible playback, seek, renderer selection, pause/resume, disable, and native-audio restoration. The repository does not fabricate a JOC entitlement for QA.
