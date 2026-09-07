# Usage

## Bilibili playback

Open a standard Bilibili VOD page. The page bridge watches the current playback manifest and reports a candidate only when it identifies a Dolby/E-AC-3 representation for the current media identity. Ordinary AAC playback stays native and does not show an active OpenJOC panel.

When the panel reports a detected JOC stream, choose **启用 OpenJOC**. OpenJOC prepares the bounded CMAF ranges, decodes them in a Worker, and waits for in-band JOC confirmation plus usable PCM before suppressing the native audio track.

The HTML video remains the master clock. Normal play, pause, buffering, seek, refresh, and SPA item changes are forwarded to the audio session. Changing to another item or disabling OpenJOC restores native playback when takeover is no longer valid.

## Output and programme level

Under **输出方式**, the current options are:

- **Stereo (Speakers)**: the fixed two-channel speaker path.
- **Binaural (Headphones)**: virtual-speaker rendering through the built-in SADIE II D1 HRTF, producing two-channel headphone output.

Under **节目电平**, the current options are:

- **Calibrated**: respects programme Dialnorm according to OpenJOC semantics.
- **Unity / 兼容模式**: disables Dialnorm attenuation. This is not a volume boost.

Binaural uses a fixed virtual 7.1.4 layout and the built-in SADIE II D1 (KU100) HRTF. The release does not expose custom SOFA files, head tracking, or virtual 9.1.6.

## Custom output gain

Open **高级** and use **自定义增益** for a separate output gain from −12 dB to +12 dB in 0.5 dB steps. The default is 0 dB. The setting is applied after rendering and is saved locally. Positive gain can clip already-loud material.

## Diagnostics

Open **高级** to see the current decoder, JOC profile, renderer, buffer, sync drift, average output level, underruns, decode p95, realtime factor, and WASM memory. Binaural mode also shows the virtual layout, HRTF source, and measured Binaural timing. See [diagnostics](diagnostics.md) for interpretation.

## Always enable

The **始终启用 OpenJOC** switch saves a local preference to attempt automatic startup whenever the current page provides a valid JOC candidate. It does not bypass Bilibili entitlement checks and does not activate ordinary audio.

## Restoring native audio

Choose **停用 OpenJOC** or **返回原生音频** to stop the replacement path. If preparation, fetching, decoding, or audio takeover fails, the extension returns the current Bilibili player mute and volume state to the native path.
