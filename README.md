# OpenJOC Browser

OpenJOC Browser brings OpenJOC E-AC-3 JOC decoding to Chromium browsers without relying on the platform's native Dolby Atmos decoder.

Phase 0 is a local developer player. It accepts raw `.ec3` files, decodes them with OpenJOC compiled to `wasm32-unknown-unknown`, renders the existing Stereo (Speakers) path, and sends 48 kHz, two-channel Float32 PCM through an AudioWorklet. Phase 1 adds a standard Bilibili VOD adapter: the normal Bilibili video remains the video source/master clock while an entitled E-AC-3 JOC representation is fetched through bounded CMAF ranges and decoded by OpenJOC WASM.

## Architecture

```text
Bilibili video page
  -> MAIN-world playurl observation
  -> isolated content controller
  -> MV3 service worker relay
  -> offscreen bounded CMAF fetch
  -> OpenJOC WASM decoder Worker
  -> timestamped AudioWorklet queue
  -> Web Audio destination

The Phase 0 local file path remains available from the extension player page.
```

The MV3 service worker only relays typed messages and owns the offscreen document lifecycle. It does not own decoder or realtime audio state. The browser CMAF layer parses only ISO-BMFF transport boundaries; OpenJOC's existing `OpenJocSession` owns E-AC-3, JOC, OAMD, reconstruction, Stereo math, in-band confirmation, and timestamp continuity.

## Build

Requirements:

- Rust 1.85 or newer with `wasm32-unknown-unknown` installed.
- Node.js 24 and the locked TypeScript 6.0.3 dev dependency.
- A sibling `OpenJOC` checkout, or `OPENJOC_ROOT` pointing at one.

From this repository:

```powershell
npm run check:wasm
npm run check
npm run build
npm run cmaf-parity
```

`npm run build` builds the `openjoc-wasm` crate from the sibling OpenJOC checkout and writes the unpacked extension to `extension/`. The local Phase 0 player rejects input files larger than 128 MiB. Bilibili Phase 1 uses bounded initialization and indexed media ranges; it does not preload an entire movie.

Open `edge://extensions` or `chrome://extensions`, enable Developer mode, choose Load unpacked, and select the absolute `extension/` directory. On a standard `https://www.bilibili.com/video/...` page, the extension adds the OpenJOC control panel when the page is reachable and the current session exposes a candidate representation.

## Verification

The project-owned synthetic lifecycle fixture is `fixtures/joc.lifecycle.ec3` (128 access units, 524288 bytes). Its SHA-256 is:

```text
b860509a1613134931e1e39b9d2b6d4d31687b1a6586d8e2bcf5fe99e7da14f8
```

Run the native-vs-WASM and CMAF parity gates after building:

```powershell
npm run parity
npm run cmaf-parity
npm test
```

`npm run parity` must report `NATIVE_VS_WASM_PCM=BIT_IDENTICAL`. `npm run cmaf-parity` must report `RAW_VS_CMAF_PCM=BIT_IDENTICAL`.

The Edge CDP smoke test needs a controlled Edge instance with the unpacked extension loaded:

```powershell
.\scripts\launch-edge.ps1 -Port 9229
node scripts/cdp-qa.mjs <port> Edge <extension-id>
node scripts/cdp-qa.mjs <port> Edge <extension-id> fixtures/malformed.ec3 fixtures/joc.ec3 --expect-error
```

Use `scripts/launch-chrome.ps1` with a different port for Chrome. It fails clearly when Chrome is not installed. A live Bilibili Dolby/JOC smoke requires the current browser profile to be entitled to that representation; the inspected temporary QA profile exposed only ordinary `mp4a`, which is correctly rejected.

## Scope

Phase 1 supports standard Bilibili VOD, Chromium/Edge, OpenJOC WASM, E-AC-3 JOC, Stereo (Speakers), and 1.0x playback. Binaural, Custom SOFA, virtual 9.1.6, non-1.0x playback, Safari, Firefox, DRM/encrypted representations, and other Bilibili player classes remain deferred or unsupported. See [docs/phase1-bilibili-plan.md](docs/phase1-bilibili-plan.md) for the adapter boundary and observed transport.

This project does not claim parity with native Dolby playback, Dolby renderer equivalence, or lossless reproduction of an authored master.
