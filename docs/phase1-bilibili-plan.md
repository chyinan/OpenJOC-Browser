# Phase 1 Bilibili JOC/CMAF integration

Phase 1 adds a Chromium MV3 adapter for standard Bilibili VOD pages. The page's normal `<video>` remains the video renderer and master clock. OpenJOC owns only the replacement audio path.

## Observed site transport

The 2026-09-03 Edge CDP observation used a standard `/video/BV.../` page and observed:

- playback manifest request: `https://api.bilibili.com/x/player/wbi/playurl`;
- DASH/fMP4 media URLs under `https://upos-*.bilivideo.com/.../*.m4s`;
- ranged responses with `206 Content-Range`, `ftyp`, `moov`, top-level `sidx`, then indexed media ranges;
- observed sample timeline for an ordinary audio representation: 48 kHz `sidx`, 54 references, 240640-sample reference duration;
- page video `currentSrc` is a `blob:` URL owned by the site's MSE player.

The inspected temporary profile exposed ordinary `mp4a`, not an entitled Dolby representation. A page title or manifest label is not treated as JOC proof; OpenJOC's in-band profile is authoritative.

## Runtime architecture

```text
Bilibili MAIN bridge
  -> exact playurl resource + sanitized candidate facts
  -> isolated content controller
  -> MV3 service worker (typed relay only)
  -> offscreen.html
       -> bounded HTTPS range fetch
       -> browser ISO-BMFF transport parser
       -> exact moof/mdat samples + PTS
       -> OpenJOC WASM packet ABI
       -> timestamped AudioWorklet queue
       -> physical Stereo (Speakers) output
```

The MAIN bridge does not patch global fetch/XHR, MediaSource, SourceBuffer, `canPlayType`, or codec support. It observes the exact current `playurl` resource from `performance` and performs one targeted page-context read with the current session. If an extension-origin range receives 403, a strictly bounded fallback asks the current page context to fetch only a URL already present in the current manifest; the extension never exposes a generic page-requested fetch oracle.

Browser code parses only BMFF transport structures: init `moov`/`mdhd`/`hdlr`/`stsd`, `sidx`, and fragment `moof`/`traf`/`tfhd`/`tfdt`/`trun`/`mdat`. E-AC-3/JOC/EMDF/OAMD semantics remain in OpenJOC Rust/WASM. `fetchCmafIndex()` starts with the observed small 8 KiB initialization range and each media request is bounded to 4 MiB; playback keeps at most two indexed fragments in its active window.

Each offscreen session creates the decoder worker before resetting and feeding CMAF samples; a missing decoder worker cannot silently consume the video clock without decoding. Preparation has bounded progress checks and reports an error when no PCM/JOC profile becomes available. The content controller sends a throttled, signed-URL-free session heartbeat so a restarted MV3 service worker can ask the page to re-register its in-memory manifest session.

The manifest bridge prefers the current page's embedded `__playinfo__` when it already contains the entitled Dolby/E-AC-3 candidate, with the exact `playurl` resource as a fallback. Page-context media ranges omit cookies because the signed media URL is sufficient and the CDN does not advertise credentialed CORS. Range responses cross the extension runtime as bounded Base64 and are restored to `ArrayBuffer` only inside offscreen parsing.

## Synchronization and failure behavior

The content controller reports `requestVideoFrameCallback().mediaTime` where available and falls back to `video.currentTime`. The offscreen document reports `AudioContext.getOutputTimestamp()`, `baseLatency`, and `outputLatency` for diagnostics. AudioWorklet consumes timestamped PCM only when the queue is aligned to the latest video media sample; future audio waits and stale audio is trimmed. Pause/buffering suspends audible output; CMAF preparation may continue only up to the bounded PCM queue limit so startup cannot deadlock. Seek/media changes increment generation and restart from the target sidx range.

Native Bilibili audio is muted only after OpenJOC has reported a non-empty in-band profile and the PCM path is ready. Disable, malformed media, fetch failure, unsupported format/rate, and extension errors clear the OpenJOC queue and restore the prior `muted`, `volume`, and `defaultMuted` state. The page-context fallback is fail-closed on CORS, non-206, mismatched Content-Range, stale generation, or over-bound response.

When a background/minimized page temporarily stops delivering video clock callbacks, offscreen extrapolates from the last real clock only for Worklet clock advancement and bounded CMAF prefetch. It never replaces the page's clock when a real update is available; pause, buffering, seek, and media-change events remain authoritative.

The content controller suppresses coarse timer/timeupdate clocks while a playing video is hidden, preventing stale background timestamps from repeatedly re-locking the audio clock. The AudioWorklet advances its running master media clock by each rendered output quantum and treats real page clocks as authoritative re-lock points; pause, seek, buffering, visibility, and recovery events force an immediate clock update.

The CMAF path keeps a 3-second PCM cushion and begins the next bounded fragment window with 4 seconds of compressed-media lead to absorb background scheduling and network jitter. The local raw-file path retains its original 1-second decode budget.

The offscreen `AudioContext` requests the `playback` latency profile and is periodically resumed if an active, non-paused session observes a non-running context, reducing sensitivity to background-window audio scheduling.

## Tests and gates

- `npm test` covers transport, URL/message validation, bounded window selection, timestamped queue, sync state, manifest candidate filtering, and the deterministic mock harness.
- `npm run cmaf-parity` compares the project-owned raw fixture with the same payload in synthetic fragmented CMAF and requires `RAW_VS_CMAF_PCM=BIT_IDENTICAL`.
- `npm run parity` retains the Phase 0 native-vs-WASM gate.
- `scripts/cdp-qa.mjs` retains local Edge/Chrome Phase 0 lifecycle QA. A live Bilibili JOC smoke still requires a user session entitled to a Dolby representation.

## Scope and limitations

Supported implementation scope: Bilibili standard VOD, Chromium-based browsers, OpenJOC WASM, E-AC-3 JOC, Stereo (Speakers), and 1.0x playback. The manifest uses only Bilibili page/API and `*.bilivideo.com` host access.

Deferred or unsupported: Binaural, Custom SOFA, virtual 9.1.6, non-1.0x time-stretch, Safari, Firefox, DRM/encrypted representations, and other Bilibili player classes. No account, region, DRM, or native Dolby bypass is implemented.
