# Security policy

## Supported versions

Security fixes are currently made against the latest release and the default development branch. The v0.1.0 package is a developer-loaded Chromium extension and should be treated as an early public release.

## Reporting a vulnerability

Please do not publish exploitable details in a public issue. Report suspected vulnerabilities privately through the repository owner's GitHub security advisory contact, or contact the maintainer through the private channel associated with the repository. Include reproduction steps, affected browser/version, extension version, and the smallest safe proof of impact. Do not include cookies, signed Bilibili URLs, account data, private media, or credentials.

Relevant areas include arbitrary page-to-extension messaging, media URL validation, cross-origin range fetching, remote code/WASM loading, permission scope, native-audio takeover/restoration, and diagnostic data exposure.

## Security design

The extension uses a narrow Bilibili host scope, validates typed messages at runtime boundaries, accepts only exact manifest-discovered HTTPS `.m4s` media URLs, bounds every range, redacts signed query parameters from diagnostics, keeps audio local, and loads no remote executable code or remote WASM. See [the architecture](docs/architecture.md) and [privacy](docs/privacy.md).
