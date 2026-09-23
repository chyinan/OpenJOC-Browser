# Third-party notices

## OpenJOC

The release WASM is built from the OpenJOC checkout selected by
`scripts/openjoc-source.mjs` (a neighboring workspace checkout when available,
otherwise the configured public source pin). The generated
`wasm/openjoc-build-info.json` records the source revision, working-tree state,
and separate HRTF assets. OpenJOC source is licensed under the Apache License,
Version 2.0; the OpenJOC source repository carries its own third-party notices.

## SADIE II D1 HRTF

The OpenJOC WASM Binaural path includes the derived SADIE II Database D1 KU100 HRIR resource used by the fixed 7.1.4 virtual-speaker renderer.

- Publisher: The Audio Lab, Department of Electronic Engineering, University of York, United Kingdom.
- Dataset: SADIE II D1 (KU100), v2-2; 48 kHz, 256 taps.
- Official project page: [SADIE II Database](https://www.york.ac.uk/sadie-project/database.html)
- Current distribution record: [Zenodo 12092466](https://zenodo.org/records/12092466)
- License: Apache License, Version 2.0, as stated by the University of York dataset notice.
- Required attribution: measurements are Copyright University of York; retain the SADIE II attribution when the data is used in original or derived form.
- Academic reference: Cal Armstrong, Lewis Thresh, and Gavin Kearney, “A Perceptual Evaluation of Individual and Non-Individual HRTFs: A Case Study of the SADIE II Database”, [doi:10.3390/app8112029](https://doi.org/10.3390/app8112029).

The Browser project does not relabel the HRTF measurements as original OpenJOC data. The release ZIP includes this notice as `THIRD_PARTY_NOTICES.txt`.

## Additional built-in HRTFs

The Browser release packages both versioned `.ojhrtf` assets separately
from the WASM renderer. Only the selected profile is fetched into WASM memory.
The asset envelope contains a payload SHA-256, and the runtime also checks the
complete asset against the OpenJOC registry before parsing.

### SADIE II D1 / KU100 (default)

- Publisher/attribution: The Audio Lab, Department of Electronic Engineering,
  University of York; measurements are Copyright University of York.
- Official source: [D1 SOFA](https://sofacoustics.org/data/database/sadie/D1_48K_24bit_256tap_FIR_SOFA.sofa)
  and [SADIE II record](https://zenodo.org/records/10886409).
- Dataset: SADIE II D1 / Neumann KU100, 48 kHz, 8,802 measured directions plus
  15 exact virtual-speaker aliases, 256 taps.
- License: Apache License 2.0; retain SADIE II / University of York attribution.
- Source SHA-256: `e6c72a84dd947b5ef75438ab96a9c2a32ed10f033472b9c4c11a49aff00a8a31`.
- Prepared CDF-1 intermediate SHA-256:
  `b9bcecd8a07e7eed4474a9b063c47672384339e83605bd245ff0adc098869fab`.
- Packaged `.ojhrtf` v2: 18,374,724 bytes; SHA-256
  `78d048a68f84d34051578c262e401e35baa0e718901f85349afe0232f985d4df`.

### SADIE II D2 / KEMAR

- Publisher/attribution: The Audio Lab, Department of Electronic Engineering,
  University of York; measurements are Copyright University of York.
- Official source: [D2 SOFA](https://sofacoustics.org/data/database/sadie/D2_48K_24bit_256tap_FIR_SOFA.sofa)
  and [SADIE II record](https://zenodo.org/records/10886409), DOI
  [10.5281/zenodo.10886409](https://doi.org/10.5281/zenodo.10886409).
- Dataset: SADIE II D2 / KEMAR, 48 kHz, 8,802 measured directions plus 15
  exact virtual-speaker aliases, 256 taps.
- License: Apache License 2.0; retain SADIE II / University of York attribution.
- Source SHA-256: `bb5980288fc5c990c821e02c5ddfa274759079b723973cd6ca47ac577243aa0c`.
- Prepared CDF-1 intermediate SHA-256:
  `88cdc843aff4a69c90465e36ab573e9b073c0b7675ce909d6900dbbc49a5ed95`.
- Packaged `.ojhrtf` v2: 18,374,724 bytes; SHA-256
  `b2f42ca2ce9ef2dfa7e3eff263543c4f306d0ac95bd684cf5ca344c88d6bd461`.

Different listeners may prefer different non-individual HRTFs because
perception depends on individual anatomy. OpenJOC provides several profiles;
no profile is claimed to be best for every listener.

## TypeScript

TypeScript `6.0.3` is a development dependency used to compile the extension source. TypeScript is distributed under Apache-2.0; it is not bundled as a runtime dependency in the extension artifact. Its package metadata and lockfile are included in the source repository.
