# Playback lifecycle recovery — 2026-09-07

## Reproduced failures

- A successful offscreen session with page generation 8 followed by a refreshed page at generation 1 sent PCM generation 1 into an AudioWorklet that still held generation 9. The real decoder-worker, AudioWorklet and WASM integration test failed after 10 seconds with `OpenJOC decoder made no progress while decoding CMAF audio`.
- The service worker rejected a different media item from a new document when its page generation was lower than the old document's generation. Conversely, a delayed lower generation within the same document could be mistaken for a refresh.
- A confirmed stream's temporary `fetching-segment` stage did not satisfy the content watchdog's `streaming` check. A simulated two-minute pause followed by playback disabled the session before a new status could arrive.
- The decoder watchdog charged an idle paused interval against its active deadline on resume. A full paused PCM queue plus a pending segment reproduced immediate failure after two simulated idle minutes.
- Two tabs sharing the same page generation could overwrite each other's clock/pause state. Moving the single audio pipeline to another tab left the old tab displaying stale active metrics.

## Changes

- Offscreen allocates a monotonic audio generation for Worker/AudioWorklet traffic independently of page generations. Status and page-context media requests keep the originating page generation.
- Service-worker session ownership records the browser-provided `MessageSender.documentId`. Content announces `document-active` before session traffic and again on a persisted `pageshow`. Ordinary late messages cannot reactivate an old document; an explicit back-forward activation can. New documents can reset their page counters; old counters within the same document remain stale.
- Content watchdog protection uses the persistent in-band JOC confirmation rather than a temporary stage label.
- Decoder watchdog state records whether the preceding interval was paused and initializes that flag from the current session.
- Offscreen clock, native-muted and dialnorm messages check tab identity as well as page generation. Switching audio ownership to another tab announces that the previous session stopped.

## Verification

`npm run test:lifecycle` executes source modules in isolated Node VM contexts with actual built WASM and the local JOC fixture. Only browser interfaces and the fetched media boundary use test adapters. Cases cover generation rollback, five consecutive refresh/item changes, paused full-queue replacement, pause/resume deadlines, document identity and multi-tab ownership.

The preferences stage finished with 50 lifecycle/startup/manifest/fetch/preferences tests passing. No core decoding algorithm or WASM ABI was changed.

## Live verification pending

Latest user verification: revision 3 resolved refresh and item-switch playback failures. Ordinary-item overlay suppression was also verified. The current follow-up is persistence of programme level and renderer, implemented and regression-tested below; do not reopen the already-verified refresh/audio lifecycle work without new evidence.

The user verified that ordinary media no longer shows the overlay. Refresh startup still failed on revision 2. The new captured trace showed start at 0 seconds (960 ms), a native history-restoring seek to 141 seconds 23 ms later, rejected old-request preparation statuses, then a new request at 2196 ms with no acknowledgement. The full-chain test now waits until the zero-second startup is actually inside a blocked index fetch before seeking to 141 seconds. It reproduced the uncancelled fetch blocking the serialized startup queue. `enqueueStartSession` now aborts the obsolete session immediately before queuing cleanup/start. Content sends no clocks during a pending seek, and background video clocks require the current request ID, so clock delivery cannot revive the old start while the explicit new start is queued. Those two regressions and stale-request clock rejection pass. Current diagnostic revision is `request-aware-recovery-3`; live refresh verification of this revision remains pending.

Review additionally reproduced cancellation failure inside the real `cmaf-fetcher`: its caller abort listener and five-second timeout were removed after headers, before `arrayBuffer()` completed. `fetchRange` now keeps both protections through body consumption and length validation. `tests/cmaf-fetch-lifecycle.test.mjs` uses the actual fetcher with a stalled response body to verify caller cancellation and body timeout; both tests failed before the fix and pass afterward.

After the build/reload handoff, the user reported that the first manual play succeeded but refreshing still showed waiting data, then reverted to Enable; manual Enable recovered. The captured failing trace contained only `session-recovery-coalesced`, fixed request ID/generation, `attempts: 1`, and `forced: false` for over 20 seconds. Browser diagnostics still return `Debugger unattached`; the user supplied this trace via a direct `data-debug` console expression.

`tests/extension-startup.test.mjs` connects actual content, background, offscreen, Worker and AudioWorklet modules. Dropping the first automatic start reproduced the same coalesced recovery deadlock. Heartbeats now carry request identity and are ordered after lifecycle operations. The background leaves an accepted slow request alone, but forces request-scoped recovery when that request is missing, stopped or replaced. Content rejects stale recovery replies and advances to the supplied generation floor. Failed offscreen deliveries mark the corresponding session stopped. Pending recovery retains the initial 35-second deadline rather than extending it forever. Tests also cover delayed decoder status, stale recovery replies, failed delivery and persistent failure. Diagnostic output includes revision `request-aware-recovery-2` to distinguish the combined recovery/manifest build. Live verification of this revision remains pending.

All background starts (explicit start, manifest replacement, toggle, clock-driven restart and dialnorm change) now use `sendSessionStart`. The failed-delivery rollback preserves newer request IDs/generations. A dialnorm restart delivery failure was independently reproduced during review and added to the passing integration suite. The harness requires accepted PCM from the current request ID, so old active overlay data cannot satisfy recovery assertions.

## Ordinary media must remain native and hidden

The user also reported OpenJOC appearing on ordinary AAC-only items. The MAIN bridge could combine stale `__playinfo__` candidates with a new page identity, reuse an old performance-resource playurl, or relabel a late response with the next item's identity. Fifteen real MAIN-module tests now cover these paths plus valid initial and next-item JOC detection, selected-part identity and back navigation after a failed API call.

Bootstrap candidates are captured only for their initial route/identity. Playurl requests are matched by current CID and any supplied BVID/AID. Results are bound to their originating request, route and media identity; navigation aborts stale requests and clears cached candidates and media-range permissions. An authoritative AAC-only response emits unavailable rather than falling back to old JOC globals. When INITIAL_STATE still belongs to the prior page, a matching playurl with complete request identity can identify the new item. New document activation also stops the previous document's audio immediately, including when the new item never publishes a JOC manifest. Ordinary items remain unrequested, unmuted and without a JOC candidate even when always-enable is saved.

Request-only identity recovery requires an explicit matching `p` value; missing API `p` is not evidence of part one. Known page-state `pages[p-1].cid` remains authoritative and does not require API `p`. Missing selected-part metadata never falls back to the first-part CID. When neither source proves the current identity, playback stays native and the overlay stays hidden until trustworthy metadata arrives. Initial bootstrap capture occurs before API fetching and closes permanently after leaving that route/identity; a successful initial API response can seed that bound snapshot if the global payload was missing. Returning to the initial route cannot capture another item's later global playinfo.

## Audio policy persistence

Programme level (`dialnormMode`: `unity`/`calibrated`) and renderer (`rendererMode`: `binaural`/`stereo`) are now saved in extension local storage on selection. They are loaded together with `alwaysEnableOpenJoc` and restored into the content state and overlay before automatic or deferred manual playback starts. Per-setting interaction flags prevent a late storage read from overwriting a newer user selection. A manual disable can cancel an enable deferred during preference loading.

Eight added startup tests cover both values of each setting across refresh (starting from the opposite saved value), slow preference reads, first decoder configuration, mid-read user changes, and deferred manual enable/cancel. Existing playback/manifest regressions still pass. Users need to reselect their desired settings once after loading this build because earlier versions did not save those choices.

## Long-pause offscreen reclamation (2026-09-07)

The user reported frozen metrics after about 30 seconds paused in the foreground. The supplied trace ends in `paused`. Chrome documents AUDIO_PLAYBACK offscreen reclamation after 30 seconds without playback. The background previously recreated an empty offscreen document for a clock while retaining `started: true`; its heartbeat therefore never requested a new decoder session.

Non-start messages now check for the actual offscreen document, invalidate vanished sessions, and do not create an empty receiver. Heartbeats perform the same existence check and use the existing request-aware restart path. Only a start creates the document. A full content/background/offscreen/WASM/worklet test destroys the audio runtime after pause, resumes, and verifies a new active request at the current position with Unity and custom gain preserved. Both new regressions fail with the prior recovery behavior and pass with the fix.

Verification: 60 lifecycle tests passed sequentially; type check, npm test, build and diff check passed. The initial parallel test/check attempt failed from system memory allocation exhaustion, not assertions. Real browser pause/resume still needs user verification. Native Bilibili mute/volume integration remains pending and is not part of this patch.

## Bilibili player mute and volume (2026-09-07)

The user confirmed long-pause recovery and requested native player controls. A separate MAIN-world `bilibili-audio-controls.ts` owns a temporary `muted` accessor on only the selected video. The page sees its logical user mute preference while the native property remains true to suppress the original track. Volume remains native. On release the accessor is removed and the latest user mute state restored; volume is not reset to an old snapshot. Preexisting own mute descriptors fail closed instead of being overwritten.

Content takes over only after confirmed JOC readiness, using a per-video token plus request/generation. The bridge acknowledgement carries volume and mute; a scoped `player-volume` runtime message applies both before arming output. Subsequent changes only adjust output gain, combining player volume with custom dB gain. Mute/zero are immediate; other live changes retain gain smoothing. Old request/generation/tab controls are rejected. No acknowledgement within two seconds falls back to native playback.

Tests use the real main bridge, content, background, offscreen, WASM and worklet with fake browser APIs/media element at the boundary. Native DOM validation additionally passed in an IAB localhost harness: logical mute toggles, physical suppression remains on, 30% volume is forwarded, release removes the proxy and preserves 30%. The harness has no media source and therefore is not an audible Bilibili end-to-end test. Actual Edge tab selection timed out, so Bilibili live validation remains user-side after extension reload and page refresh. The prior parallel testing memory failures were avoided using sequential lifecycle tests.

## Custom output gain

The user confirmed the saved Dialnorm and renderer settings work, then requested custom gain in Advanced. Chosen range: −12 to +12 dB, 0.5 dB steps, default 0 dB. The advanced control has a range, numeric input and explicit reset; live telemetry does not replace these elements during dragging. `outputGainDb` is saved through the same preference-loading guards. Reset always notifies persistence, even if the current display is already zero.

`output-gain.ts` owns bounds, normalization and dB-to-amplitude conversion. The AudioWorklet exposes an a-rate `outputGain` AudioParam and applies it after PCM queue reading, before loudness measurement. Offscreen schedules live changes with a 15 ms target time constant without resetting decoding; initial settings apply before playback. Gain messages are scoped to request/tab identity and retained during pending startup. Both Stereo and Binaural use the same output layer. Default gain 1 skips multiplication and preserves PCM values.

Real browser localhost preview verified range dragging, keyboard 0.5 dB steps, numeric input, limits and reset with 100 ms telemetry updates. A native AudioWorklet smoke test used a muted downstream output and measured −6.098 dB for a .25-amplitude input with +6 dB gain (ideal −6.041 dB, with the initial smoothing interval). The AudioContext was closed after measurement. An initial unarmed/silent graph's 200 ms parameter read was inconclusive; the active PCM smoke test passed.

One first concurrent lifecycle run exited its startup test subprocess without an assertion. The full startup file then passed 21/21 independently and the complete TAP rerun passed 57/57 without changing concurrency. A further explicit-zero-reset regression was added and passed. Temporary preview files are in ignored `artifacts/gain-preview*`; no real video or account state was changed during UI verification.

Final gain verification: 58/58 lifecycle/gain tests passed, along with existing tests, type checking, build and diff checks. The Reset review finding was fixed and independently rechecked. The temporary preview tab and server were closed after UI/native-audio verification. The built extension is ready to reload for the new advanced gain control.

The user's browser still had the previous build during reported failures. Browser inspection obtained one trace with coalesced session-recovery requests followed by a 35-second start give-up. Later DOM and CDP reads failed with `Debugger unattached` or timed out; the subsequent frozen -25-second metrics were reported by the user, not recovered from a new live trace.

Reload the unpacked extension from the built `extension/` directory, then verify playback with changing PCM metrics, repeated refreshes, automatic next-item transitions and pause/resume. Local regression success is not a substitute for this live check.
