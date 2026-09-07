# Third-party notices

## OpenJOC

The release WASM is built from OpenJOC commit `e123aa3a0e2878587c73130585a5606db4ff233f` in the public [OpenJOC repository](https://github.com/chyinan/OpenJOC/tree/e123aa3a0e2878587c73130585a5606db4ff233f). OpenJOC source is licensed under the Apache License, Version 2.0. The OpenJOC source repository carries the complete license and its own third-party notices.

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

## TypeScript

TypeScript `6.0.3` is a development dependency used to compile the extension source. TypeScript is distributed under Apache-2.0; it is not bundled as a runtime dependency in the extension artifact. Its package metadata and lockfile are included in the source repository.
