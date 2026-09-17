# Release Scope

WikiKB 0.1 supports:

- The Node.js `wkb` CLI.
- Issue-driven Agentic Workflows and their GitHub Actions support files.
- The agent-guided installer and its conflict-aware target-repository copier.

The GitHub release attaches an allowlisted `cli-agentic-workflows` archive and SHA-256 checksum. It includes supporting source plus checksum-pinned LexCAT executables for `linux/x64`, `linux/arm64`, `darwin/arm64`, `darwin/x64`, and `win32/x64`: `lexcat-v0.0.18-linux-x86_64.tar.gz`, `lexcat-v0.0.18-linux-arm64.tar.gz`, `lexcat-v0.0.18-macos-arm64.tar.gz`, `lexcat-v0.0.18-macos-x86_64.tar.gz`, and `lexcat-v0.0.18-windows-x86_64.zip`.

WikiKB source is provided under the MIT License. The bundled LexCAT executables are unchanged third-party binary-only components, are expressly excluded from the MIT grant, and remain subject to their separate terms. The LexCAT team's authorized binary release permits redistribution with WikiKB; that authorization does not grant source, modification, relicensing, or separate-redistribution rights. The bundle includes their third-party notice.

LexCAT is the only retrieval backend. Unsupported hosts cannot index, search, or query unless `WIKIKB_LEXCAT_BIN` points to an operator-approved executable.

LexCAT provides model-free lexical BM25 retrieval. It downloads no model, has no embedding step, and needs no network at query time.

The archive excludes dependency trees, generated output, caches, credentials, `.env` files, and deferred product paths. Runtime source is not included.

At runtime, `wikikb-cache-v1` stores bounded generated indexes and integrity manifests in the wiki Git repository. It contains no rendered Markdown and is not embedded in the release archive.

GitHub's automatic tag snapshots are repository snapshots. The reproducible attached archive is the supported artifact.

Agentic Workflows are supported only in private repositories with trusted
collaborators and wiki writers. Their models receive no direct Bash, GitHub, or
network tools; constrained jobs apply declared text safe outputs. The local CLI
may be used without those workflows.
