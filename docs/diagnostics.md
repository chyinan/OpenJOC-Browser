# Diagnostics

The panel's **高级诊断** view is a live snapshot for the current session. Values are diagnostic evidence, not a quality or certification claim.

## Status and stages

The user-facing phases are `preparing`, `ready`, `active`, `paused`, `buffering`, `error`, and `disabled`. Internal preparation stages may include `starting-audio`, `starting-decoder`, `fetching-index`, `fetching-page-context-index`, `fetching-segment`, `decoding`, `waiting-for-joc-profile`, and `streaming`.

- `preparing`: the offscreen audio session or decoder is being created.
- `ready`: PCM and JOC confirmation are available; native audio takeover may be completing.
- `active`: OpenJOC output is armed and following the video clock.
- `paused` / `buffering`: audible output is paused while the page is paused or lacks enough media data.
- `error`: the current replacement session stopped and native audio is restored.
- `disabled`: no OpenJOC replacement session is active.

## Main values

- **Decoder / Input / Profile** identify the pinned OpenJOC WASM path, E-AC-3 JOC input, and the in-band profile reported by the decoder.
- **Renderer / Virtual Layout / HRTF** identify Stereo or Binaural, the fixed `7.1.4` layout, and `Built-in SADIE II D1 (Default)` when applicable.
- **Audio drift** compares the current timestamped audio position with the video master clock. Repeated large values indicate buffering, a seek, background throttling, or a media/session transition.
- **Average level** is post-gain PCM RMS expressed as dBFS with a finite silence floor. It is labeled dB, not LUFS.
- **Buffer** reports queued PCM duration. **Underruns** count Worklet output quanta that lacked PCM.
- **Decode p95** and **Realtime factor** describe measured WASM processing cost on the current machine; they vary by host.
- **WASM memory** reports the current bounded memory snapshot exposed by the decoder.

## Privacy of diagnostics

Signed media query parameters are removed before a media URL is displayed in diagnostics. The lifecycle trace is held in memory for the current page session and is not uploaded. Raw diagnostic JSON is available only from the advanced panel for local troubleshooting.
