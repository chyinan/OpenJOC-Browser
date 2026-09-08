# Changelog

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
