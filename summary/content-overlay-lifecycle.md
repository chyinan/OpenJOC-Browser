# Content overlay lifecycle summary

## Relevant flow

`src/bilibili-content.ts` owns the page-local video identity, current manifest, playback request, and `JocOverlayController`. When a Bilibili SPA replaces the video element or URL, it resets the manifest/overlay and waits for the current page-world bridge to publish a new manifest.

`src/bilibili-main-bridge.ts` can emit an `unavailable` transition while a new route/media identity is being resolved, then publish the new manifest after an asynchronous playurl request. Browser message delivery can leave an older page-world message queued while the content script has already moved to another video.

## Root cause

The content script structurally validated page-world messages but did not verify their `pageUrl` against the current `location.href`. A delayed manifest from the old video could replace `latestManifest`, and a delayed unavailable message could clear it and hide the OpenJOC overlay even when the current video had a JOC stream. A separate same-page failure remained after that guard: on repeated SPA navigation, the current page identity could settle after the old page's `playurl` had left the Performance Resource Timing window, leaving the bridge with no current manifest source.

## Fix boundary

`bilibili-content.ts` now accepts manifest and unavailable messages only when their page URL is the current page URL. The guard is applied before either message can mutate `latestManifest`, playback state, generation, or overlay state.

`bilibili-main-bridge.ts` now allows a non-initial route to use a changed, non-empty embedded `__playinfo__` candidate fingerprint when no current playurl resource is available. It refuses this fallback unless the initial document had a confirmed embedded candidate and the candidate fingerprint changed, preventing a stale global payload from being relabelled onto a new page. It also observes and retains a bounded set of playurl URLs so a valid request remains discoverable after the browser evicts older Performance Resource Timing entries.

## Field debugging

The content overlay host exposes `data-openjoc-state`, including its current mode and playback status. The MAIN-world bridge exposes `data-openjoc-bridge-debug` on `document.documentElement`, including the current route/media identity, matched playurl, resolved manifest, pending request, recent sanitized `/player/` resource fields, and a bounded trace of meaningful scan/request events. Periodic no-op scans do not erase the trace, and neither attribute contains signed query strings. These attributes remain available when the overlay is hidden.

## Regression coverage

`tests/content-lifecycle.test.mjs` reproduces a same-Tab A → C switch, delivers the current C manifest, then delivers stale A manifest/unavailable messages. The current C identity and visible JOC overlay must remain intact. `tests/main-bridge-lifecycle.test.mjs` covers repeated embedded-manifest recovery, stale payload rejection, and playurl discovery after Performance Resource Timing eviction.
