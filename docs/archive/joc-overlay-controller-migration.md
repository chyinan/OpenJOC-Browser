# JOC video overlay controller migration

> Investigated and implemented 2026-09-03.

## Demo contract

The reference UX Demo separates the product controller from its state-preview navigation. The product states are detection notice, active panel, collapsed capsule, advanced diagnostics, raw JSON, error, and manual non-JOC notice. Detection is wider than the normal panel, keeps the primary action on one line, and places close independently in the upper-right corner. Advanced technical data is a secondary layer; raw JSON is a tertiary disclosure with its own copy action.

## Browser baseline

- `src/bilibili-content.ts` is the MV3 isolated content controller and owns the video master, JOC manifest, enable/disable, native mute snapshot/restore, generation lifecycle, and runtime status forwarding.
- `src/offscreen.ts` publishes playback phase, error reason, profile, drift, PCM/compressed buffer, underrun, decode p95, realtime factor, and WASM peak memory through the validated `offscreen-status` message.
- The content script must load as a classic script. TypeScript source can use modules, but `scripts/build.mjs` must bundle `extension-protocol.js`, `joc-overlay-state.js`, `joc-overlay-controller.js`, and `bilibili-content.js` into `extension/bilibili-content.bundle.js` before the manifest references it.

## Implementation boundary

- `src/joc-overlay-state.ts` is the Functional Core: immutable state transitions, detection dismissal, enable/disable, collapse/expand, diagnostics/raw nesting, error detail toggling, renderer availability, and Dialnorm selection.
- `src/joc-overlay-controller.ts` is the Imperative Shell: Shadow DOM creation, responsive CSS, safe dynamic text escaping, clipboard copy, view rendering, and callbacks into the existing content lifecycle.
- `src/bilibili-content.ts` remains the media/session Imperative Shell and no longer owns product UI markup or raw JSON rendering.

## Error layout decision

The error panel reserves a dedicated summary block after the header: human-readable reason, stable category-derived code, and a separately bounded details region. Long reasons wrap inside the block; details scroll within a capped height. `返回原生音频` is the only primary action. The code is derived from stable reason/stage categories because the current status contract does not carry a dedicated error-code field.

## Live level display

The normal health row is `平均响度`, backed by one-second RMS dBFS statistics from the actual two-channel AudioWorklet output. It is intentionally labeled dB rather than LUFS; the value is clamped to a finite `-96 dB` silence floor. Advanced Realtime diagnostics keep the technical PCM buffer row and also expose the same average dB value.
