# OpenJOC-Browser

[![CI](https://github.com/chyinan/OpenJOC-Browser/actions/workflows/ci.yml/badge.svg)](https://github.com/chyinan/OpenJOC-Browser/actions/workflows/ci.yml)
[![Release](https://github.com/chyinan/OpenJOC-Browser/actions/workflows/release.yml/badge.svg)](https://github.com/chyinan/OpenJOC-Browser/actions/workflows/release.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

OpenJOC-Browser brings OpenJOC E-AC-3 JOC decoding to Chromium-based web playback through WebAssembly and Web Audio.

The first public release targets Microsoft Edge and Google Chrome. The primary site integration is standard Bilibili VOD when the current account/session exposes an E-AC-3 JOC representation. A local extension player is also available for project-owned `.ec3` fixtures and development testing.

## Current capabilities

- OpenJOC WASM decoding of E-AC-3 JOC.
- Bilibili standard VOD detection and bounded CMAF range loading.
- Stereo (Speakers) output and Binaural (Headphones) output.
- Fixed Binaural virtual layout: 7.1.4.
- Built-in SADIE II D1 (KU100) HRTF for Binaural mode.
- The Bilibili `<video>` remains the video renderer and master clock.
- Play, pause, seek, buffering, refresh, and single-page media changes are generation-aware.
- Saved renderer, Dialnorm, always-enable, and custom output-gain preferences.
- Diagnostics for JOC profile, sync drift, buffers, underruns, decode timing, and WASM memory.

## How it works

```text
Bilibili page
  -> MAIN-world manifest/media bridge
  -> isolated content controller
  -> MV3 service worker
  -> offscreen AudioContext
  -> bounded CMAF fetch and browser transport parsing
  -> OpenJOC WASM decoder Worker
  -> timestamped AudioWorklet PCM
  -> Web Audio output
```

The browser code handles page integration, media URL policy, ISO-BMFF transport boundaries, lifecycle, and clock alignment. E-AC-3/JOC parsing and rendering remain in OpenJOC. See [the architecture guide](docs/architecture.md).

## Install from a GitHub release

When a GitHub release is available, download `OpenJOC-Browser-v0.1.0-chromium.zip` from its Assets and extract it. The extracted top-level directory is the loadable extension root.

For Microsoft Edge:

1. Open `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select the extracted `OpenJOC-Browser-v0.1.0/` directory—the directory containing `manifest.json`.

For Google Chrome, use the same steps at `chrome://extensions`.

The extension is not distributed through the Chrome Web Store or Microsoft Edge Add-ons in this release. To update it, remove or reload the old unpacked directory and load the newly extracted directory. To uninstall, use the browser extension page's **Remove** action.

See [installation](docs/installation.md) for permission details and limitations.

## Use it on Bilibili

1. Open a supported standard Bilibili VOD page.
2. Wait for the OpenJOC panel to report that a JOC stream is detected.
3. Choose **启用 OpenJOC**.
4. Select **Stereo (Speakers)** or **Binaural (Headphones)** under **输出方式**.
5. Select **Calibrated** or **Unity / 兼容模式** under **节目电平**.
6. If needed, open **高级** to inspect diagnostics or change **自定义增益**.

**Calibrated** follows the programme Dialnorm metadata according to OpenJOC semantics. **Unity / 兼容模式** disables Dialnorm attenuation; it is not a volume boost. The custom gain control is separate and ranges from −12 dB to +12 dB in 0.5 dB steps.

OpenJOC takes over only after a non-empty in-band JOC profile and usable PCM are confirmed. If it is disabled or fails, the original Bilibili audio is restored with the latest player mute and volume settings.

See [usage](docs/usage.md) and [diagnostics](docs/diagnostics.md).

## Scope and limitations

The v0.1.0 implementation targets:

- Microsoft Edge and Google Chrome on Chromium's extension platform.
- Standard Bilibili VOD pages.
- 48 kHz, two-channel output and 1.0x playback.
- Unencrypted, browser-fetchable E-AC-3 JOC CMAF representations.

Safari, Firefox, DRM/encrypted representations, other Bilibili player classes, non-1.0x playback, head tracking, custom SOFA selection, and virtual 9.1.6 are not part of this release. Bilibili availability can vary by account, region, content, and session entitlement. A page title or ordinary E-AC-3 label is not treated as proof of JOC; in-band OpenJOC confirmation is required.

This project does not claim parity with a platform Dolby renderer, identical native Dolby/Apple binaural behavior, lossless reproduction of an authored master, or certification/endorsement by Dolby Laboratories.

## Privacy and security

The extension reads the current Bilibili page's media identity, playback manifest candidates, video clock, and player mute/volume state only to operate the current session. It does not send audio, diagnostics, or browsing history to an OpenJOC service. It has no analytics, telemetry, account login, or credential collection. Only playback preferences are stored locally in extension storage.

Media requests go to Bilibili endpoints needed for the selected session. Signed query strings are not persisted in extension storage or included in diagnostics. The exact permissions and data flows are documented in [privacy](docs/privacy.md) and [security](SECURITY.md).

## Build from source

Prerequisites are Git, Node.js 24.15.0, npm, Rust 1.85 or newer, and the `wasm32-unknown-unknown` Rust target. The build resolves OpenJOC from its public repository at an exact commit; an existing sibling checkout is not required.

```powershell
npm ci
npm run check:version
npm run check:release-policy
npm run check:wasm
npm run check
npm test
npm run build
npm run package:release -- --version 0.1.0
npm run validate:release -- --version 0.1.0
```

The generated extension is written to `extension/`. The release ZIP is written to `release/`. See [development](docs/development.md) for the exact toolchain, parity gates, browser QA, and an explicit local-source override.

## Relationship to OpenJOC

This repository consumes the OpenJOC WASM bridge from the public OpenJOC Git repository at commit [`e123aa3a0e2878587c73130585a5606db4ff233f`](https://github.com/chyinan/OpenJOC/commit/e123aa3a0e2878587c73130585a5606db4ff233f). The Browser build checks that the resolved checkout is exactly that commit. OpenJOC remains a separate project and is licensed under Apache-2.0.

## Project documents

- [Installation](docs/installation.md)
- [Usage](docs/usage.md)
- [Architecture](docs/architecture.md)
- [Diagnostics](docs/diagnostics.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Privacy](docs/privacy.md)
- [Development](docs/development.md)
- [Release engineering](docs/release.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License and trademarks

OpenJOC-Browser source is available under the [Apache License 2.0](LICENSE). OpenJOC-Browser is an independent open-source project. “Dolby”, “Dolby Atmos”, and related marks belong to Dolby Laboratories and are used here only to describe compatibility with media formats or workflows; this project is not affiliated with, endorsed by, certified by, or sponsored by Dolby Laboratories.
