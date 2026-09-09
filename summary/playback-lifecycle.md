# Playback lifecycle summary

## Relevant flow

`src/bilibili-content.ts` owns the page video and emits request-scoped `video-clock` messages. The page suppresses coarse hidden-page timer clocks only while the video is playing; pause, play, visibility, seek, and frame callbacks can still emit clocks.

`src/service-worker.ts` validates and routes page messages. Lifecycle messages use a per-tab promise tail, but `video-clock` was handled through a separate fire-and-forget path. Each clock performs an asynchronous offscreen liveness check before forwarding, so concurrent checks can complete out of order.

`src/offscreen.ts` stores the latest page clock in `session.isPaused` and forwards it to the Worker and AudioWorklet. When the page clock is stale and `session.isPaused` is false, it extrapolates a `paused:false` clock for prefetch and audio-clock continuity.

`src/pcm-processor.ts` advances its master media clock only while not paused/buffering. Its reported drift is the queued/current audio media sample position minus that master clock. Audio that continues while the video is paused therefore appears as positive drift approximately equal to the unintended playback duration.

When a background tab suppresses page clock updates and the next foreground clock jumps far ahead of the queued audio, the same timestamped queue reports a large negative drift and waits indefinitely for old PCM to catch up. `src/offscreen.ts` now rebuilds the current session only when the authoritative page clock has also been stale beyond the background threshold; a recent foreground clock never rebuilds merely because the current CMAF segment begins more than two seconds before the video target. Same-request rebuilds preserve native-audio takeover, player volume/mute, and output gain, then re-arm the new AudioWorklet generation; otherwise the content controller would not send a second takeover acknowledgement and the rebuilt session would remain in `ready`/“waiting for audio”.

Live Edge diagnosis reproduced the bad predicate as a one-second `active → preparing → active` loop on the same request ID during initial playback. After gating video-lag recovery on stale page-clock age, a fresh Edge page remained active with approximately -19 ms sync drift and non-empty loudness instead of cycling through “waiting for data”.

Minimizing Edge can suspend or heavily throttle the offscreen document's window timers while the AudioWorklet render thread remains active. Prefetch therefore also runs from accepted Worklet stats: when the PCM queue falls to a two-second low-water mark, the offscreen shell pumps the next bounded CMAF window. This keeps background decoding alive without depending on `setInterval` delivery and remains disabled while paused or buffering.

## Regression evidence

`tests/service-worker-lifecycle.test.mjs` now reproduces a delayed running clock completing after a newer paused clock. Before the fix, the offscreen message order ends in `paused:false`.

## Implemented fix boundary

Page clocks are serialized per tab before offscreen liveness checking/forwarding, while lifecycle operations remain independent so a stuck clock cannot block a new start. After asynchronous forwarding, the Service Worker rechecks the request/session identity before updating stored media time.

The start contract carries initial paused/buffering state from the content page through the Service Worker. The offscreen document initializes the Session and AudioWorklet with that state immediately after reset, so an already paused video cannot start audible output.

If the AudioWorklet reports audio more than two seconds ahead of the authoritative page clock, the offscreen document rebuilds the session from that page clock instead of waiting for future PCM timestamps to catch up.
