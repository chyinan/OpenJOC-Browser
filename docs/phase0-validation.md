# Phase 0 validation record

Date: 2026-09-02

## Rust and WASM

- OpenJOC baseline: `master`, HEAD `ad6556babf42566f1a09820b01dc333703c8b1da`, version `0.16.0`, clean before the bridge change.
- Browser repository: new Git repository on `codex/phase0-wasm-stereo`.
- WASM bridge branch: `codex/openjoc-wasm-bridge`.
- `npm run check:wasm`: passed with `wasm32-unknown-unknown`.
- `npm run parity`: reported `NATIVE_VS_WASM_PCM=BIT_IDENTICAL bytes=1573120`.
- Native and WASM lifecycle totals: 128 access units, 196640 output samples, 48 kHz, two channels.
- WASM timing sample: decode mean/p95/max `2.757/2.934/12.168 ms`, render `0.129/0.173/2.765 ms`, total `2.894/3.160/12.778 ms`, realtime factor `11.058`.

The 196640 samples equal 128 × 1536 programme samples plus the declared 32-sample FinalLinkedGain tail.

## Edge machine QA

Controlled Edge version: `152.0.4191.53`.

The unpacked extension page loaded with `Worker` and `AudioWorkletNode` available. The lifecycle run reported:

```text
profile=etsi-strict
downmixIndex=0
objects=1
complexityIndex=1
sampleRate=48000
outputChannels=2
decodeAccessUnits=128
outputSamples=196640
queueAudioMs=1019.33
underruns=0
nativeDolbyDecoderUsed=false
```

The browser diagnostics also expose the timing summary and realtime factor. Timing values vary by host; the machine gate checks that they are finite, positive, and ordered mean ≤ p95 ≤ max.

The same controlled run covered Pause → Resume → Stop/Reset and lifecycle fixture → short fixture reopen. The malformed fixture produced `invalid E-AC-3 access-unit range`, zero decoded access units, zero output samples, and no console errors.

The long lifecycle run also waited for the AudioWorklet queue to drain to 5 ms or less with zero underruns. The short eight-AU fixture is intentionally below the 128 ms preroll target; its terminal drain is not used as the steady-state realtime gate.

## Remaining gates

- Chrome machine QA is pending because no Chrome executable is installed on the current host.
- Human audible smoke in Chrome and Edge is pending; headless/CDP checks do not prove speaker output.
- CMAF `.m4s` input remains deferred; raw `.ec3` is the Phase 0 mandatory path.
