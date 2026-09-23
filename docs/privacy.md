# Privacy

OpenJOC-Browser is a local browser extension. It has no OpenJOC account, cloud service, analytics endpoint, telemetry collector, or sign-in flow.

## Information read

On a supported Bilibili page, the extension reads only information needed for the current playback session:

- the current page URL and Bilibili media identity (`bvid`, `aid`, `cid`);
- page playback state and the current video element's clock, pause, buffering, rate, mute, and volume values;
- the current page's embedded playback data and matching Bilibili playurl resource to find E-AC-3/JOC candidates;
- exact signed media URLs and bounded byte ranges for the representation selected by that page.

The local player reads a user-selected `.ec3` file only after the user chooses it from the file picker.

## Where data goes

The extension sends media requests only to Bilibili's playback API/page context and the `bilivideo.com` or scoped `upos-*.akamaized.net` media hosts needed for the selected session. Decoded audio, PCM, diagnostics, and lifecycle state remain in the browser. They are not sent to an OpenJOC server or third-party analytics service.

The page-context fallback receives only an exact manifest-discovered media URL and bounded range. It is not a general page-requested fetch service. Signed query strings are not written to extension storage or diagnostics.

## What is stored

`chrome.storage.local` stores only these playback preferences:

- `alwaysEnableOpenJoc`
- `dialnormMode`
- `rendererMode`
- `outputGainDb`

The extension does not store browsing history, visited URLs, media files, signed media URLs, cookies, credentials, account identifiers, or user audio. It stores selected playback preferences and, after the user chooses D2 or Aachen, the corresponding public `.ojhrtf` data asset in extension Cache Storage for offline reuse. Assets are checked against the locally packaged byte length and SHA-256 before the renderer receives them.

## Permissions and hosts

The `activeTab` permission supports a user-initiated toolbar toggle. `offscreen` supports the isolated Web Audio document. `storage` supports local playback preferences. `unlimitedStorage` allows the extension to retain the approximately 200 MB Aachen data asset without normal storage quota eviction. The Bilibili content scripts match standard VOD pages; `bilivideo.com` and Akamai host permissions allow bounded range requests to the selected media host, with runtime validation rejecting unrelated hosts. GitHub and `release-assets.githubusercontent.com` permissions are used only for the versioned HRTF data release; no JavaScript or WASM is fetched remotely. D1 ships in the extension and requires no network access.

See [SECURITY.md](../SECURITY.md) for reporting and [the manifest review](release.md#manifest-review) for the current permission audit.
