# Browser Phase 1 Architecture Investigation

Investigation date: 2026-09-03.

## Confirmed

- Browser currently has only `player.html` + `player.ts` local raw `.ec3` playback.
- `decoder-worker.ts` sends raw elementary stream chunks to `WasmDecoderClient.pushBytes()`; WASM frames complete AUs internally.
- `pcm-processor.ts` uses a bounded `PcmQueue`, but PCM blocks have no media PTS.
- `generation.ts` and `decoder-generation.ts` can isolate seek, media changes, and asynchronous decoder loads.
- OpenJOC API `OpenJocPacket` already supports `pts_samples`, `discontinuity`, and `preroll`; `OpenJocPcmFrame` already carries `pts_samples`; Rust validates timestamp continuity.
- `openjoc-container::cmaf` already validates `dec3`, the constrained CMAF JOC track, and complete samples. Its reader depends on seekable files/ffprobe and is not a browser HTTP/range parser.
- `openjoc-wasm` currently exposes only `push_bytes`; its Decoder passes `pts_samples: None`, `discontinuity: false`, and `preroll: false`.
- The MV3 manifest has no content scripts, permissions, host permissions, offscreen document, or Bilibili entry.

## Live Bilibili observation

- Standard `/video/BV.../` VOD page exposes `videoData`, `bvid`, `aid`, `cid`, and duration in page state.
- Playback request observed at `https://api.bilibili.com/x/player/wbi/playurl` with current page parameters including `fnval=4048`, `from_client=BROWSER`, and `need_fragment=false`; signed query values were redacted and not stored.
- Media requests observed at `https://upos-*.bilivideo.com/.../*.m4s`; signed/session query values were not stored.
- Page video `currentSrc` is `blob:https://www.bilibili.com/...`, so the site player owns an MSE/blob video source and its media URL cannot be inferred from `video.src`.
- Automated profile did not reach a reliable playing-video state (`readyState=0`, `duration=null` at capture); this confirms the discovery path but not JOC entitlement or successful real audio playback. Final human smoke remains required.

## Missing capability

- Bilibili adapter, MAIN-world observation bridge, isolated content controller, typed messages, and action toggle.
- Generic fragmented MP4 transport parser for init/moov and moof/traf/tfdt/trun/mdat plus bounded range fetch.
- Timestamped WASM sample ABI and worker protocol.
- Video-master clock state machine, video frame/currentTime observation, Web Audio output timing/drift diagnostics.
- Native video mute snapshot/restore, safe fallback, and SPA/media identity lifecycle.
- Deterministic mock Bilibili harness, raw-vs-CMAF parity, and browser site smoke.

## Design boundary

Browser code parses only ISO-BMFF transport structure and sample boundaries. E-AC-3/JOC/EMDF/OAMD semantics remain in Rust/WASM. The site adapter owns only Bilibili page/media discovery and current-session requests. No global fetch/XHR patch, SourceBuffer patch, MediaSource replacement, or codec-support spoofing. Cross-origin fetch requires the current Bilibili tab association, approved `bilivideo.com` host, HTTPS, bounded size/range, and typed schema. When extension-origin fetch returns 403, the only fallback is a current-page-context fetch for an exact manifest-discovered signed URL and exact bounded range; service worker and offscreen validate the response before CMAF parsing.
