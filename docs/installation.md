# Installation

## Prerequisites

Users need a current desktop installation of Microsoft Edge or Google Chrome. The v0.1.0 package is an unpacked Chromium extension; it does not require Rust, Node.js, or an OpenJOC checkout.

## Install from the release ZIP

1. Download `OpenJOC-Browser-v0.1.0-chromium.zip` from the GitHub Release Assets.
2. Extract it. Open the extracted `OpenJOC-Browser-v0.1.0/` directory.
3. Open `edge://extensions` in Edge or `chrome://extensions` in Chrome.
4. Enable **Developer mode**.
5. Select **Load unpacked**.
6. Choose the extracted directory containing `manifest.json`.

The Edge and Chrome packages are intentionally the same Chromium artifact. Do not select the repository's source directory or a nested build directory.

## Update

Download and extract the new release ZIP, then use **Reload** for the existing unpacked extension or remove the old extension and choose **Load unpacked** for the new directory. Refresh any open Bilibili page after reloading the extension.

## Uninstall

Open the browser extension page, find **OpenJOC Browser**, and choose **Remove**. Removing the extension also removes its locally stored preferences. The extension does not create a separate account or service.

## Permissions

- `activeTab`: lets the toolbar action address the currently active page after a user click.
- `offscreen`: creates the hidden audio document needed for Web Audio playback outside the page lifecycle.
- `storage`: stores the four playback preferences locally.
- `https://bilivideo.com/*` and `https://*.bilivideo.com/*`: permit bounded range requests for the exact Bilibili media URL selected by the current page session.

The content scripts run only on `https://www.bilibili.com/video/*`. No generic all-sites host permission is requested.

## Known installation limitations

Developer mode may show a browser warning for an unpacked extension. That is expected. The extension cannot be loaded on arbitrary sites, and it cannot make a JOC representation available when Bilibili does not provide one to the current session.
