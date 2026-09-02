# Phase 1 Bilibili integration plan

This document records the next integration boundary only. It contains no Bilibili code and is not part of the Phase 0 playback path.

## Main-world page bridge

Use a small MAIN-world bridge for page-owned media observations. Keep the extension's isolated-world code responsible for messaging and validation. The bridge should expose only the media facts required for synchronization.

## Dolby representation discovery

Observe the native video element and its selected Dolby-capable representation through the page's existing playback metadata. Treat representation changes as state transitions. Do not assume a fixed URL or DOM shape.

## Extension fetch

Fetch the selected audio representation in the extension-controlled path, validate the response and container boundaries, then pass raw E-AC-3/CMAF samples to the existing OpenJOC WASM adapter.

## Clock and audio ownership

- Keep native video as the master clock.
- Mute only the native audio path after the replacement PCM path is ready.
- Send decoded PCM to the same AudioWorklet queue used by the local player.

## Synchronization

Define explicit play, pause, seek, rate-change, and teardown messages. Seek must reset the decoder and queue before accepting samples for the new timeline. A/V drift should be measured against video time, not hidden with unbounded buffering.

## Deferred decisions

Phase 1 must still decide how to handle representation switches, network retries, discontinuities, and browser-specific media events. Those decisions require a separate design review before website-specific code is added.
