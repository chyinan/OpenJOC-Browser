# Release engineering

## Release artifact shape

The release offers one Chromium ZIP:

`OpenJOC-Browser-vX.Y.Z-chromium-standard.zip`

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
  wasm/hrtf/sadie-ii-d2-kemar.ojhrtf
  LICENSE
  THIRD_PARTY_NOTICES.txt
```

The package always includes both D1 and D2, with their registry-pinned byte lengths and SHA-256 values. There is no separate Full package because both profiles are available offline in the Standard ZIP. The package script excludes source maps and hidden files, uses stable file ordering and fixed ZIP metadata, and writes a SHA-256 checksum next to the artifact. The first-release source-map policy is `EXCLUDE`.

The build copies both HRTF assets from the selected OpenJOC source checkout and verifies their hashes before packaging. Browser playback never fetches HRTF data from GitHub or another asset host.

## Release workflow

`.github/workflows/release.yml` runs only for a `v*.*.*` tag. It checks that the tag version equals `package.json` and `extension/manifest.json`, installs dependencies with `npm ci`, resolves OpenJOC, runs checks/tests, builds the Standard package with both HRTFs, validates the asset manifest and ZIP checksum, and creates a draft GitHub Release with the ZIP and checksum attached. For a reproducible release, set `OPENJOC_SOURCE_PIN` to the exact 40-hex compatible OpenJOC commit; unsafe path-like values are rejected. Otherwise standalone builds resolve the configured ref (default `master`) and record its actual commit.

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

The current manifest review is PASS:

- `activeTab` is used by the user-initiated toolbar toggle.
- `offscreen` is used for the hidden audio document.
- `storage` is used for local playback preferences.
- `https://bilivideo.com/*`, `https://*.bilivideo.com/*`, and `https://*.akamaized.net/*` are used for bounded selected-media range requests; Chrome match patterns cannot express the `upos-` host prefix, so runtime validation narrows Akamai usage to `upos-*.akamaized.net` at every message boundary.
- Both `.ojhrtf` assets are packaged locally; the extension requests no HRTF asset host permission.
- Content scripts match only standard Bilibili VOD URLs.
- There is no `all_urls`, `web_accessible_resources`, `externally_connectable`, cookie permission, or arbitrary-URL fetch message.
- `wasm-unsafe-eval` is limited to extension pages because WebAssembly instantiation needs it; no remote JavaScript or remote WASM is loaded.

## Human gates

After automated gates pass, use the exact ZIP from `release/` for one Edge and one Chrome load test where those browsers are available. On a Bilibili session with an entitled JOC representation, verify detection, enable, audible playback, seek, renderer selection, pause/resume, disable, and native-audio restoration. The repository does not fabricate a JOC entitlement for QA.
