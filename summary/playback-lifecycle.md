# Playback lifecycle summary

## Relevant flow

`src/bilibili-content.ts` owns the page video and emits request-scoped `video-clock` messages. The page suppresses coarse hidden-page timer clocks only while the video is playing; pause, play, visibility, seek, and frame callbacks can still emit clocks.

`src/service-worker.ts` validates and routes page messages. Lifecycle messages use a per-tab promise tail, but `video-clock` was handled through a separate fire-and-forget path. Each clock performs an asynchronous offscreen liveness check before forwarding, so concurrent checks can complete out of order.

`src/offscreen.ts` stores the latest page clock in `session.isPaused` and forwards it to the Worker and AudioWorklet. When the page clock is stale and `session.isPaused` is false, it extrapolates a `paused:false` clock for prefetch and audio-clock continuity.

`src/pcm-processor.ts` advances its master media clock only while not paused/buffering. Its reported drift is the queued/current audio media sample position minus that master clock. Audio that continues while the video is paused therefore appears as positive drift approximately equal to the unintended playback duration.

## Regression evidence

`tests/service-worker-lifecycle.test.mjs` now reproduces a delayed running clock completing after a newer paused clock. Before the fix, the offscreen message order ends in `paused:false`.

## Implemented fix boundary

Page clocks are serialized per tab before offscreen liveness checking/forwarding, while lifecycle operations remain independent so a stuck clock cannot block a new start. After asynchronous forwarding, the Service Worker rechecks the request/session identity before updating stored media time.

The start contract carries initial paused/buffering state from the content page through the Service Worker. The offscreen document initializes the Session and AudioWorklet with that state immediately after reset, so an already paused video cannot start audible output.

If the AudioWorklet reports audio more than two seconds ahead of the authoritative page clock, the offscreen document rebuilds the session from that page clock instead of waiting for future PCM timestamps to catch up.
