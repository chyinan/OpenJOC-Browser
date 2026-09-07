# Changelog

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
