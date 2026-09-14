# Vendored LexCAT runtime

WikiKB ships LexCAT 0.0.16, a model-free lexical retrieval CLI, as binary-only
platform archives. WikiKB uses LexCAT as its indexing and retrieval runtime.
The runtime is mandatory for indexing and retrieval; no source checkout,
runtime download, or alternate retrieval path is included.

`manifest.json` is authoritative for platform selection and SHA-256
verification. WikiKB verifies the archive and executable before extracting the
runtime into the user's private cache. `WIKIKB_LEXCAT_BIN` can select an
approved, operator-managed executable for controlled testing and deployment.

Every package contains unchanged executable bytes from the LexCAT team's
authorized binary release. WikiKB packages the executable as `lexcat` or
`lexcat.exe` for runtime-path compatibility and wraps it in a checksum-pinned
archive. The manifest also pins the digest of the original release asset, which
matches the `SHA256SUMS` manifest published with the release. No private
source-repository locator or executable network fetch is part of the release.

Microsoft has authorized the WikiKB maintainer to redistribute these unchanged
compiled LexCAT binaries with WikiKB. The executable remains a separately
licensed component: WikiKB's MIT license does not grant source, modification,
or relicensing rights for LexCAT. Runtime source is not included. The licensing
boundary is recorded in `THIRD_PARTY_NOTICES.txt`.

Unlike the retrieval runtime it replaces, LexCAT is model-free: ranking is
BM25 over an analyzer-built term-document matrix, so there is no model to
download, pin, verify, or cache, and retrieval never contacts a network
service.

## Platform coverage

| Platform | Archive |
| --- | --- |
| `linux/x64` | `lexcat-v0.0.16-linux-x86_64.tar.gz` |
| `linux/arm64` | `lexcat-v0.0.16-linux-arm64.tar.gz` |
| `darwin/arm64` | `lexcat-v0.0.16-macos-arm64.tar.gz` |
| `darwin/x64` | `lexcat-v0.0.16-macos-x86_64.tar.gz` |
| `win32/x64` | `lexcat-v0.0.16-windows-x86_64.zip` |

LexCAT 0.0.16 publishes no native `win32/arm64` binary. Windows on ARM runs the
x64 executable under emulation, so WikiKB selects the `win32/x64` archive there.
Any other platform fails with an explicit error and requires `WIKIKB_LEXCAT_BIN`
to point at an approved executable.

## Index compatibility

LexCAT writes a single SQLite index whose schema version is pinned in
`manifest.json`. WikiKB does not rely on LexCAT to reject a stale index:
0.0.16 reads and syncs an index written by an older schema without
complaint. The guarantee comes from WikiKB instead — the cache sidecar
records `runtime_compatibility` as `release:<version>`, so bumping the
vendored runtime invalidates every cached index and forces a rebuild
before any query runs.

WikiKB reads results through `lexcat query --json`, which returns each hit's
text and provider metadata, so WikiKB never binds against the on-disk schema
directly.