# Historical Phase 0 validation record

> This document records an earlier development checkpoint. For the current
> v0.1.0 scope, installation, architecture, limitations, and release gates,
> use the linked documents in the repository root README.

Date: 2026-09-03

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

Human Edge audible smoke: `PASS`. The same unpacked extension played a real DEE E-AC-3 JOC `.ec3` through the physical audio device. OpenJOC decode was active, the Stereo (Speakers) output was audible, steady-state underruns were zero, and no playback error occurred.

Playback level was relatively low. The Phase 0 path keeps OpenJOC's calibrated/program Dialnorm behavior; it does not add arbitrary gain. Calibrated / Unity Dialnorm selection belongs in a later Browser UX task.

The browser diagnostics also expose the timing summary and realtime factor. Timing values vary by host; the machine gate checks that they are finite, positive, and ordered mean ≤ p95 ≤ max.

The same controlled run covered Pause → Resume → Stop/Reset and lifecycle fixture → short fixture reopen. The malformed fixture produced `invalid E-AC-3 access-unit range`, zero decoded access units, zero output samples, and no console errors.

The long lifecycle run also waited for the AudioWorklet queue to drain to 5 ms or less with zero underruns. The short eight-AU fixture is intentionally below the 128 ms preroll target; its terminal drain is not used as the steady-state realtime gate.

## Remaining gates

- Chrome machine QA is pending because no Chrome executable is installed on the current host.
- Human Edge audible smoke is `PASS`; human Chrome audible smoke is `PENDING` until Chrome is installed.
- CMAF `.m4s` input remains deferred; raw `.ec3` is the Phase 0 mandatory path.

## Phase 0 verdict

```text
HUMAN_EDGE_AUDIO = PASS
HUMAN_CHROME_AUDIO = PENDING
NATIVE_DOLBY_DECODER_USED = NO
CHROMIUM_OPENJOC_REALTIME_PROOF = PENDING_CHROME
READY_FOR_BILIBILI_PHASE1 = NO
```

Do not begin Bilibili Phase 1 automatically. The remaining highest-value action is Chrome installation and repetition of the same controlled and audible smoke tests.
