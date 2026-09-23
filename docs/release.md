# Release engineering

## Release artifact shape

The release offers two Chromium ZIPs:

`OpenJOC-Browser-vX.Y.Z-chromium-standard.zip`

`OpenJOC-Browser-vX.Y.Z-chromium-full.zip`

Edge and Chrome use the same Manifest V3 output. The ZIP expands to:

```text
OpenJOC-Browser-vX.Y.Z/
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
  wasm/hrtf/manifest.json
  wasm/hrtf/sadie-ii-d1-ku100.ojhrtf
  LICENSE
  THIRD_PARTY_NOTICES.txt
```

Standard includes D1 only. Full additionally includes D2 and Aachen, using the exact same canonical `.ojhrtf` files and checksums. Both retain the same three-preset selector and local manifest. The package script excludes source maps and hidden files, uses stable file ordering and fixed ZIP metadata, and writes a SHA-256 checksum next to each artifact. The first-release source-map policy is `EXCLUDE`.

D2/Aachen URLs are fixed in the packaged manifest to `https://github.com/chyinan/OpenJOC/releases/download/openjoc-hrtf-v2.0.0/`. GitHub Release downloads redirect to `release-assets.githubusercontent.com`; the release gate allows only those two HTTPS origins. `npm run check:hrtf-assets-remote` streams each external asset, verifies exact byte length and SHA-256 against the local registry, and is a mandatory Browser release-workflow step before packaging. The configured `openjoc-hrtf-v2.0.0` asset release is currently absent, so that gate will block a Browser release until D2 and Aachen have been uploaded and verified. The current implementation downloads the whole file (no range-resume); range support is available at the host but not yet used.

## Release workflow

`.github/workflows/release.yml` runs only for a `v*.*.*` tag. It checks that the tag version equals `package.json` and `extension/manifest.json`, installs dependencies with `npm ci`, resolves OpenJOC, runs checks/tests, builds the Standard WASM package, verifies the remote D2/Aachen asset release, validates the asset manifest and both ZIP checksums, and creates a draft GitHub Release with the Standard and Full ZIPs and checksums attached. For a reproducible release, set `OPENJOC_SOURCE_PIN` to the exact 40-hex compatible OpenJOC commit; unsafe path-like values are rejected. Otherwise standalone builds resolve the configured ref (default `master`) and record its actual commit. Full/offline ZIP is built and validated separately with `npm run build:full` and `npm run package:full`.

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
npm run check:hrtf-assets-remote
npm run package:release -- --version 0.1.0
npm run validate:release -- --version 0.1.0 --hrtf-package standard
npm run build:full
npm run package:full -- --version 0.1.0
npm run validate:release -- --version 0.1.0 --hrtf-package full
```

This is the local equivalent of the release job. It does not create a Git tag or GitHub Release.

## Manifest review

The current manifest review is PASS:

- `activeTab` is used by the user-initiated toolbar toggle.
- `offscreen` is used for the hidden audio document.
- `storage` is used for local playback preferences; `unlimitedStorage` preserves large downloaded HRTF assets for offline reuse.
- `https://bilivideo.com/*`, `https://*.bilivideo.com/*`, and `https://*.akamaized.net/*` are used for bounded selected-media range requests; Chrome match patterns cannot express the `upos-` host prefix, so runtime validation narrows Akamai usage to `upos-*.akamaized.net` at every message boundary.
- `https://github.com/*` and `https://release-assets.githubusercontent.com/*` are used only to fetch the fixed-version D2/Aachen `.ojhrtf` data assets after selection; the parser accepts only the local versioned schema and SHA-pinned files.
- Content scripts match only standard Bilibili VOD URLs.
- There is no `all_urls`, `web_accessible_resources`, `externally_connectable`, cookie permission, or arbitrary-URL fetch message.
- `wasm-unsafe-eval` is limited to extension pages because WebAssembly instantiation needs it; no remote JavaScript or remote WASM is loaded.

## Human gates

After automated gates pass, use the exact ZIP from `release/` for one Edge and one Chrome load test where those browsers are available. On a Bilibili session with an entitled JOC representation, verify detection, enable, audible playback, seek, renderer selection, pause/resume, disable, and native-audio restoration. The repository does not fabricate a JOC entitlement for QA.
