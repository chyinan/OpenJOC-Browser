# Progress: Bilibili JOC CMAF Playback and Video-Master A/V Sync

> Created: 2026-09-03 | Status: in progress

## Goal

Implement and validate real E-AC-3 JOC/CMAF playback for a standard Bilibili VOD in OpenJOC-Browser. The normal Bilibili video remains visible and is the master clock; OpenJOC WASM decodes timestamped Stereo PCM and safely handles play, pause, seek, buffering, disable, failure recovery, and SPA media changes.

## Success criteria

Discover only media permitted by the current Bilibili session and confirm JOC in-band. CMAF and raw EC-3 decode must be bit-identical. Chromium/Windows native Dolby must not be used. Video-master sync, lifecycle, permissions, fetch boundaries, logging safety, and Phase 0 regression must pass. No push, release, Binaural, DRM bypass, or non-1.0x playback.

## Read files

- `C:\Users\chyinan\.codex\RTK.md` — prefix shell commands with `rtk`.
- `C:\Users\chyinan\.agents\skills\using-plan-and-execute\SKILL.md`
- `C:\Users\chyinan\.agents\skills\focused-problem-solver\SKILL.md`
- User-provided Phase 1 task text.
- `D:\Programs\OpenJOC-Browser\PROGRESS-openjoc-browser-phase0-wasm-stereo.md`
- Browser package, TypeScript config, manifest, Phase 1 plan, README.
- Browser Phase 0 sources: player, service worker, decoder worker, worker protocol, PCM queue, AudioWorklet, WASM bindings, generation modules.
- Browser build and CDP QA scripts.
- OpenJOC CMAF, container, WASM, stream, FFI, and API sources/tests.
- Real Bilibili standard VOD via Edge CDP: playurl request, DASH/fMP4 m4s media, bilivideo CDN, blob video.

## Current progress

Codebase entry points, WASM/CMAF boundaries, and live Bilibili manifest/media observations are complete. Phase 2 route selected: offscreen audio with typed content/main bridge and browser transport parser. Phase 3 design is implemented. Pure-core TDD cycles for transport extraction, video-master decisions, timestamped PCM queue, URL/message security, manifest filtering, drift metrics, and the mock harness are green. Rust/WASM packet PTS and Dialnorm modes are green. Full quality gates and security/media review are in progress.

## Task tracker

- [x] Phase 1: understand current state, constraints, and acceptance criteria
- [x] Phase 2: compare and select implementation route
- [x] Phase 3: validate design boundaries and implementation plan
- [x] Write tests and implement
- [ ] Run browser, Node, and Rust verification
- [ ] Complete security/media review, docs, and focused commits
- [ ] Produce final Phase 1 report

## Next step

Write the failing Rust/WASM timestamp ABI test, then implement the packet/PCM PTS path before wiring extension lifecycle shells.

## Key findings

- Browser has no Bilibili adapter, content script, MAIN-world bridge, offscreen document, CMAF parser, seek protocol, timestamped PCM, video clock, or native audio restoration.
- OpenJOC API already supports packet PTS/discontinuity/preroll and PCM PTS; current WASM ABI does not expose them.
- OpenJOC Rust CMAF validation is semantic and depends on native/ffprobe container paths; Browser should parse only generic BMFF transport and keep E-AC-3/JOC semantics in Rust/WASM.
- Real Bilibili observation used `x/player/wbi/playurl`, DASH/fMP4 `.m4s`, and `*.bilivideo.com`; signed query parameters were not retained in diagnostics.
