# Usage

## Bilibili playback

Open a standard Bilibili VOD page. The page bridge watches the current playback manifest and reports a candidate only when it identifies a Dolby/E-AC-3 representation for the current media identity. Ordinary AAC playback stays native and does not show an active OpenJOC panel.

When the panel reports a detected JOC stream, choose **启用 OpenJOC**. OpenJOC prepares the bounded CMAF ranges, decodes them in a Worker, and waits for in-band JOC confirmation plus usable PCM before suppressing the native audio track.

The HTML video remains the master clock. Normal play, pause, buffering, seek, refresh, and SPA item changes are forwarded to the audio session. Changing to another item or disabling OpenJOC restores native playback when takeover is no longer valid.

## Output and programme level

Under **输出方式**, the current options are:

- **Stereo (Speakers)**: the fixed two-channel speaker path.
- **Binaural (Headphones)**: fixed virtual-speaker rendering through one of three built-in generic profiles, producing two-channel headphone output.

Under **节目电平**, the current options are:

- **Calibrated**: respects programme Dialnorm according to OpenJOC semantics.
- **Unity / 兼容模式**: disables Dialnorm attenuation. This is not a volume boost.

Binaural uses a fixed virtual 7.1.4 layout. The selector offers **SADIE II — KU100** (Default / Reference), **SADIE II — KEMAR**, and **Aachen — High-Resolution KEMAR**. Different listeners may prefer different non-individual HRTFs because perception depends strongly on individual anatomy; no profile is best for everyone.

The Standard package includes D1 and works offline after installation. D2 and Aachen are fetched only after selection, with downloading, verification, and renderer-preparation states shown in the panel. A verified asset is kept in extension storage and can be used offline on later runs. Choose the Full offline package to include all three profiles without first-use downloads. This Browser extension does not expose Custom SOFA import, head tracking, or virtual 9.1.6.

## Custom output gain

Open **高级** and use **自定义增益** for a separate output gain from −20 dB to +20 dB in 0.5 dB steps. The default is 0 dB. The setting is applied after rendering and is saved locally. Positive gain can clip already-loud material.

## Interface language

The panel interface defaults to Chinese. Open **高级** and use **语言 / Language** to switch between **简体中文**, **English**, and **日本語**. The choice covers every panel label, including the detection notice, the active panel, the advanced diagnostics, the error panel, and their accessible names. The language is saved as a local preference, so a reload or a new video keeps the selected interface.

The selector is part of the advanced layer only; the normal panel keeps its original layout and controls. English is a translation of the same interface, not a separate diagnostic mode.

## Diagnostics

Open **高级** to see the current decoder, JOC profile, renderer, buffer, sync drift, average output level, underruns, decode p95, realtime factor, and WASM memory. Binaural mode also shows the virtual layout, HRTF source, and measured Binaural timing. See [diagnostics](diagnostics.md) for interpretation.

## Always enable

The **始终启用 OpenJOC** switch saves a local preference to attempt automatic startup whenever the current page provides a valid JOC candidate. It does not bypass Bilibili entitlement checks and does not activate ordinary audio.

## Restoring native audio

Choose **停用 OpenJOC** or **返回原生音频** to stop the replacement path. If preparation, fetching, decoding, or audio takeover fails, the extension returns the current Bilibili player mute and volume state to the native path.
