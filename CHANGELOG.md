# Changelog

## [Unreleased]

## [0.2.0] - 2026-10-15

### Changed

- Build the Browser decoder against released OpenJOC v0.20.0 (`d6a247641a5b56dae219afcca7bca491a70f9548`).
- Include the core's decoder continuity, grouped-frame dialnorm, and custom SOFA interpolation correctness fixes in the WASM playback path.

### Scope

- OpenJOC v0.20.0's new AVX direct-FIR path and AArch64 adjacent-output unroll apply to native builds. The Browser's `wasm32-unknown-unknown` build retains the scalar fallback for that code; this update does not add browser GPU acceleration or claim a new WASM SIMD speedup.
- Correctness fixes can change previously incorrect output. The strict parity gates remain in place; this release does not claim identical PCM to v0.1.9 for every input.

## [0.1.9] - 2026-10-07

### Changed

- Build the Browser decoder against released OpenJOC v0.19.0 (`291900ce33ea349c4b855655cdb282819e94eabc`), including the QMF and binaural FIR performance improvements in the actual WASM playback path.
- Share one reviewed core source manifest across CI, release packaging, and standalone builds; explicit source pins cannot silently use an unrelated neighboring checkout.
- Raise the documented Rust minimum to 1.89, matching the core.

The performance changes preserve PCM for the same platform and configuration. The core update also includes intentional decoder correctness fixes, so this is not a claim that every input matches older Browser releases bit-for-bit.

### Fixed

- Report current WASM memory separately from peak usage in the diagnostics panel and copied diagnostics.

## [0.1.8] - 2026-09-28

### Changed

- Updated the pinned decoder source to the latest OpenJOC v0.18.0 revision.

### Fixed

- Stopped JOC audio when its Bilibili video tab closes instead of allowing queued audio to continue in the background.
- Restored the saved Always enable OpenJOC setting and output gain after page reloads and when opening videos in another tab.
- Fixed missing HRTF helper references in the packaged content script that aborted preference restoration.

## [0.1.7] - 2026-09-25

### Added

- Added a local Custom SOFA importer with parser validation, SHA-256 identity, and IndexedDB persistence. Imported SOFA bytes stay on the device.
- Bundled SADIE II D1 / KU100 and SADIE II D2 / KEMAR for offline use; D1 remains the default.
- Added interface-language selection with Chinese, English, and Japanese translations.
- Added catalogue, overlay, and packaged-bundle coverage for all supported interface languages.

### Changed

- Reduced first binaural-switch latency by beginning HRTF preparation while the replacement audio segment is being fetched.
- Kept HRTF selection and renderer revisions consistent across cached Custom SOFA switches.

### Fixed

- Prevented a delayed Custom SOFA import from overriding a newer HRTF selection.
- Preserved the previous active profile when Custom SOFA validation or renderer initialization fails.

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
