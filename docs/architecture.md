# Architecture

## Runtime pipeline

```text
Bilibili standard VOD page
  -> MAIN-world bridge reads current page state and exact playurl resources
  -> isolated content controller owns the video and product UI
  -> MV3 service worker validates and routes typed messages per tab/document
  -> offscreen document owns AudioContext and the current audio session
  -> bounded HTTPS range fetch (with exact page-context fallback when required)
  -> ISO-BMFF/CMAF transport parser extracts timestamped E-AC-3 samples
  -> OpenJOC WASM decoder Worker validates and renders JOC
  -> timestamped PCM crosses the AudioWorklet boundary
  -> Web Audio destination
```

The `HTMLVideoElement` is the master clock. The audio queue aligns timestamped PCM to the latest video media time, trims stale audio, waits for future audio, and reports drift. The offscreen document may extrapolate briefly when a background page stops sending clocks, but real page clocks remain authoritative.

## Extension contexts

- `bilibili-main-bridge.js` runs in the Bilibili page's MAIN world. It observes `__INITIAL_STATE__`, `__playinfo__`, and matching `performance` resource entries for the current `x/player/wbi/playurl` request. It also performs the narrowly scoped page-context range fallback.
- `bilibili-content.bundle.js` runs as an isolated content script. It selects the master video, controls the overlay, owns media identity/generation state, and forwards clocks and user actions.
- `service-worker.js` is a typed relay and session registry. It associates messages with a tab and browser-provided document identity, validates candidate URLs, and creates/recreates the offscreen document. It does not own decoder state or realtime audio.
- `offscreen.html` loads `offscreen.js`. The offscreen document owns the audio session, bounded CMAF fetches, AudioContext, AudioWorklet node, Worker, buffering, recovery, and status snapshots.
- `player.html` is the local raw `.ec3` developer/QA page. It uses the same WASM Worker and AudioWorklet boundaries but does not access Bilibili.

## Data boundaries

Browser code parses only ISO-BMFF transport structure: initialization metadata, `sidx`, fragments, sample boundaries, timestamps, and bounded ranges. E-AC-3, JOC, EMDF, OAMD, reconstruction, Dialnorm semantics, Stereo rendering, and Binaural rendering remain in the pinned OpenJOC WASM bridge.

The Worker boundary carries validated commands and generation-scoped PCM/status messages. PCM is copied out of WASM before the WASM memory can be reused. The AudioWorklet boundary carries only timestamped Float32 PCM, clock updates, reset/pause/resume commands, and bounded queue statistics.

## Security boundary

The MAIN bridge accepts only messages from the current page window and posts to the fixed Bilibili origin. Candidate media URLs must be HTTPS `.m4s` resources on `bilivideo.com`, must be present in the current manifest, and must fit the four-megabyte range bound. Messages crossing the extension runtime are schema-checked and tied to the current tab, document, request, media key, and generation.

No global fetch/XHR patch, SourceBuffer patch, MediaSource replacement, codec-support spoofing, remote executable code, remote WASM, externally connectable surface, or web-accessible resource is used.

## Lifecycle and synchronization

Each start receives a request identity and an audio generation independent of the page generation. Seek, refresh, media replacement, offscreen reclamation, Dialnorm changes, and renderer changes invalidate obsolete work before a new session is queued. Preparation has bounded range, PCM, and progress budgets. Native audio is suppressed only after the replacement path has reported a non-empty in-band JOC profile and usable PCM; all failure paths restore native audio.
