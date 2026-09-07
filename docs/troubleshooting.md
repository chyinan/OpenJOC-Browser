# Troubleshooting

## No JOC stream detected

The current page or session did not expose a valid E-AC-3 JOC candidate. Check that the page is a standard Bilibili VOD, wait for playback metadata to load, and refresh the page after reloading the extension. A title or ordinary E-AC-3 stream is not sufficient; the in-band JOC profile must be confirmed.

## Unsupported page or item

The release targets standard Bilibili VOD pages. Other Bilibili player classes, non-Bilibili sites, DRM/encrypted media, Safari, and Firefox are outside the current scope. Ordinary AAC-only items intentionally remain on native audio.

## Audio cannot start

Browser autoplay policy may prevent an audio context from starting. Interact with the page and start playback from the normal player controls, then enable OpenJOC. If the page is paused or buffering, the panel may remain in `paused` or `buffering` until the video can play.

## Fetch or CMAF error

Open **高级诊断** and note the stage. `fetching-index` or `fetching-segment` failures usually indicate that the current signed media URL expired, the representation is unavailable, or the response was not a bounded `206 Content-Range`. Refresh the page to obtain a current representation. The extension does not retry arbitrary URLs or bypass DRM.

## Malformed or unsupported JOC

The decoder rejects malformed access units, unsupported profiles, invalid CMAF structure, and unsupported playback rates. OpenJOC does not produce replacement audio in these cases; the native Bilibili audio path is restored.

## A/V sync reset or stale metrics

Seek once and wait for the page to settle. The session is generation-aware and restarts from the new video position. After an extension reload, refresh the Bilibili page as well. A long paused interval can allow Chromium to reclaim the offscreen audio document; the next active clock heartbeat requests a new session.

## Native audio restoration

When OpenJOC is disabled or fails, the extension releases its temporary audio-control hook and restores the latest Bilibili mute and volume state. If the panel reports that native audio control is unavailable, reload the page and extension and try again.

## Extension reload/update

After loading a new unpacked directory, click **Reload** on the extension page and refresh all open supported pages. Do not mix generated files from two extension directories.
