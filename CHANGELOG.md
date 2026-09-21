# Changelog

## [Unreleased]

### Added

- Added an interface-language selector to the advanced panel. The controller now renders from a shared Chinese/English catalogue, defaults to Chinese, and saves the choice locally; the panel keeps its existing layout, controls, and styling. This includes the diagnostics group headings, which are keyed by a stable group id instead of a display string.
- Added catalogue, overlay, and packaged-bundle coverage for both interface languages, including assertions on the rendered diagnostics group headings.

## [0.1.6] - 2026-09-14

### Fixed

- Added scoped support for Bilibili overseas Akamai media hosts (`upos-*.akamaized.net`) while keeping runtime URL validation tied to the current manifest.
- Parsed CMAF `mvex/trex` default sample duration and size values used by overseas Dolby fragments.
- Retried failed CMAF segments on the next manifest mirror and kept the first working mirror for subsequent segments.
- Deferred early native-audio activation until the in-band JOC profile is confirmed, preventing silent startup after play or seek.
- Added regression coverage for overseas CDN detection, CMAF defaults, 403/page-context fallback, mirror failover, and activation ordering.

## [0.1.5] - 2026-09-13

### Fixed

- Fixed background playback stopping after the browser window was minimized. OpenJOC could physically mute the original video before its first real unmuted playback, causing Chromium to classify the media as always muted and automatically pause it while the page was hidden.
- Delayed native-audio takeover until the current video has played unmuted at least once. Existing user pause, mute, muted-autoplay, and offscreen-recovery behavior remains intact.
- Added end-to-end regression coverage for paused startup, muted autoplay, first unmuted play, native-audio restoration, and offscreen recovery.

## [0.1.2] - 2026-09-09

### Fixed

- Prevented stale background playback clocks from restarting paused audio and accumulating delay.
- Preserved paused/buffering state during startup and rebuilt playback when audio drifted more than two seconds ahead of the video clock.

## [0.1.1] - 2026-09-08

### Changed

- Expanded the custom output gain range from −12 dB to +12 dB to −20 dB to +20 dB, retaining 0.5 dB steps.

## [0.1.0] - 2026-09-07

First public GitHub release preparation.

### Added

- Chromium Manifest V3 integration for standard Bilibili VOD JOC playback.
- OpenJOC WASM decoding with Stereo (Speakers) and Binaural (Headphones) output.
- Fixed 7.1.4 Binaural layout with built-in SADIE II D1 HRTF.
- Video-master synchronization, bounded CMAF range loading, lifecycle recovery, and diagnostics.
- Local raw `.ec3` player and deterministic parity/lifecycle test gates.
- Reproducible source resolution, CI, draft-release packaging, checksum validation, and public documentation.

### Limitations

See [the current limitations](README.md#scope-and-limitations). The release does not target Safari, Firefox, DRM/encrypted media, non-1.0x playback, head tracking, custom SOFA selection, virtual 9.1.6, or additional Bilibili player classes.
