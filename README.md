# OpenJOC Browser

OpenJOC Browser brings OpenJOC E-AC-3 JOC decoding to Chromium browsers without relying on the platform's native Dolby Atmos decoder.

Phase 0 is a local developer player. It accepts raw `.ec3` files, decodes them with OpenJOC compiled to `wasm32-unknown-unknown`, renders the existing Stereo (Speakers) path, and sends 48 kHz, two-channel Float32 PCM through an AudioWorklet.

## Architecture

```text
local file picker
  → decoder Worker
  → OpenJOC WASM bridge
  → transferable PCM blocks
  → AudioWorklet queue
  → Web Audio destination
```

The MV3 service worker only opens `player.html`. It does not own decoder or realtime audio state. The bridge uses OpenJOC's existing `OpenJocSession` and `parse_access_unit_bounds`; it does not reimplement E-AC-3, JOC, OAMD, reconstruction, or Stereo math in TypeScript.

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
```

`npm run build` builds the `openjoc-wasm` crate from the sibling OpenJOC checkout and writes the unpacked extension to `extension/`.

The player rejects input files larger than 128 MiB. The Worker receives the selected file through a transferable `ArrayBuffer`, and the WASM bridge bounds pending AU input, PCM frames, and timing samples.

Open `edge://extensions` or `chrome://extensions`, enable Developer mode, choose Load unpacked, and select the absolute `extension/` directory. Click the OpenJOC Browser action to open the local player.

## Verification

The project-owned synthetic lifecycle fixture is `fixtures/joc.lifecycle.ec3` (128 access units, 524288 bytes). Its SHA-256 is:

```text
b860509a1613134931e1e39b9d2b6d4d31687b1a6586d8e2bcf5fe99e7da14f8
```

Run the native-vs-WASM PCM gate after building:

```powershell
npm run parity
npm test
```

`npm run parity` compares the native OpenJOC Stereo Float32 byte stream with the same fixture decoded through the generated WASM module. It must report `NATIVE_VS_WASM_PCM=BIT_IDENTICAL`.

The Edge CDP smoke test needs a controlled Edge instance with the unpacked extension loaded:

```powershell
.\scripts\launch-edge.ps1 -Port 9229
node scripts/cdp-qa.mjs <port> Edge <extension-id>
node scripts/cdp-qa.mjs <port> Edge <extension-id> fixtures/malformed.ec3 fixtures/joc.ec3 --expect-error
```

Use `scripts/launch-chrome.ps1` with a different port for Chrome. It fails clearly when Chrome is not installed.

The second command checks bounded malformed-input diagnostics. The QA script also covers pause, resume, stop/reset, and reopening a second fixture.

## Scope

Phase 0 does not implement Bilibili integration, Binaural, Custom SOFA, virtual 9.1.6, Safari, or Firefox. See [docs/phase1-bilibili-plan.md](docs/phase1-bilibili-plan.md) for the future integration boundary.

This project does not claim parity with native Dolby playback. It proves that the OpenJOC clean-room decoder and existing Stereo renderer can run inside a Chromium extension.
