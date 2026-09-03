# Progress: Bilibili JOC CMAF Playback and Video-Master A/V Sync

> Created: 2026-09-03 | Status: debugging live-site lifecycle stall

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

Codebase entry points, WASM/CMAF boundaries, and live Bilibili manifest/media observations are complete. Phase 2 route selected: offscreen audio with typed content/main bridge and browser transport parser. Phase 3 design is implemented. Pure-core TDD cycles for transport extraction, video-master decisions, timestamped PCM queue, URL/message security, manifest filtering, drift metrics, and the mock harness are green. Rust/WASM packet PTS and Dialnorm modes are green. Browser and OpenJOC quality gates are green. Live Bilibili JOC entitlement smoke remains pending because controlled QA exposed only ordinary mp4a; no entitlement was bypassed.

## Task tracker

- [x] Phase 1: understand current state, constraints, and acceptance criteria
- [x] Phase 2: compare and select implementation route
- [x] Phase 3: validate design boundaries and implementation plan
- [x] Write tests and implement
- [x] Run browser, Node, and Rust verification
- [x] Complete manual security/media review, docs, and focused commits
- [ ] Produce final Phase 1 report after human live-site smoke

## Next step

Perform the human smoke on an entitled standard Bilibili Dolby/JOC VOD: enable, verify in-band profile/active Stereo audio, pause/resume, seek forward/back, buffering, then disable and verify native audio restoration.

## Key findings

- Browser has no Bilibili adapter, content script, MAIN-world bridge, offscreen document, CMAF parser, seek protocol, timestamped PCM, video clock, or native audio restoration.
- OpenJOC API already supports packet PTS/discontinuity/preroll and PCM PTS; current WASM ABI does not expose them.
- OpenJOC Rust CMAF validation is semantic and depends on native/ffprobe container paths; Browser should parse only generic BMFF transport and keep E-AC-3/JOC semantics in Rust/WASM.
- Real Bilibili observation used `x/player/wbi/playurl`, DASH/fMP4 `.m4s`, and `*.bilivideo.com`; signed query parameters were not retained in diagnostics.
- Automated gates: `npm run check`, `npm test`, `npm run check:wasm`, `npm run parity`, `npm run cmaf-parity`, Edge CDP Phase 0 normal/malformed QA, Rust fmt/check/clippy/full test all passed. Rust full test: 927 passed, 10 ignored.
- Commits: Browser `5ef3797` plus UI status `f2785cf`; OpenJOC `7061215`.
- Review status: manual security/media review completed; two delegated code-review attempts timed out and were stopped, so no delegated zero-issue result is claimed.
- Live smoke follow-up: user reproduced `403 for bytes 0-8191` after the initial-range fix; the next isolated change preserves the full Bilibili page Referer policy observed in native CDP requests.
- Live smoke follow-up: Referer policy also did not remove 403; added fail-closed page-context fallback for exact manifest-discovered media ranges, with tab/generation/URL/Content-Range/size validation.
- Live smoke follow-up: page-context fallback removed the 403 and video time advanced, but preparation could stall when pause/buffering blocked CMAF backpressure; added bounded CMAF-only decode backpressure that does not wait on pause.
- Live smoke follow-up: repeated pause/resume reached `heartbeat lost`; root cause matched Offscreen `AUDIO_PLAYBACK` idle lifetime while the context was suspended during preparation. Added a zero-gain keepalive graph and kept the offscreen context running while Worklet output remains silent for pause/buffering.
- Live smoke follow-up: first startup remaining `preparing` is expected until in-band JOC confirmation; pause/resume state had no transition back from `paused` when JOC was not yet confirmed. Added pure-core `resumeAudioPhase` and offscreen integration so resume returns to `preparing`/`ready`/`active` according to confirmed and muted state.
- Live smoke follow-up: user confirmed `currentVideoMediaTime` advanced while `currentAudioMediaTime` stayed null and the extension never reached `ready`. Root cause: offscreen `startSession()` defined `ensureWorker()` but never called it; `worker?.postMessage()` therefore dropped every CMAF sample. The session now initializes the worker before reset/feeding, fails clearly on decode/progress timeout, and reports decoded AU/output counters.
- Live smoke follow-up: repeated pause/resume could lose the MV3 service worker's in-memory session routing and freeze both status and video-clock diagnostics. Added a throttled signed-URL-free session heartbeat and content-driven session re-registration when the service worker map is missing or stale.
- Live CDP smoke: the logged-in P1 page exposed one `dash.dolby.audio` candidate with `codecs=ec-3`; the bridge now reads embedded `window.__playinfo__` before relying on a possibly changing `playurl` resource. Page-context media ranges use credential-free CORS and return `206`.
- Live CDP smoke: the actual 8 KiB P1 initialization range parses as `ec-3`, `dec3`, unencrypted, and `sidx`/48000 Hz. Fixed BMFF leaf-box recursion, encoded page-range responses as bounded Base64 across Chrome runtime messages, and forwarded AudioWorklet `queue-stats` to release decoder backpressure.
- Live CDP smoke passed: P1 reached `active` with `profile=observed-vendor-compat`, `inbandJocConfirmed=true`, 3390 decoded AUs, 3389 output frames, 5205504 output samples, and approximately 51 ms video/audio drift. Five consecutive pause/resume cycles returned to `active` and audio time continued advancing.
