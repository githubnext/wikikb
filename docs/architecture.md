# Architecture

WikiKB implements Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern: evidence feeds an agent-maintained Markdown wiki that compounds over time. The wiki's normal branch is canonical; indexes are replaceable cache state.

## Components

| Component | Role |
| --- | --- |
| GitHub wiki | Source, concept, query, and navigation pages |
| `wkb` | Sync, retrieval, prompting, ingestion, and maintenance |
| LexCAT | Only indexing and retrieval backend |
| `wikikb-cache-v1` | Shared generated indexes |
| `~/.wikikb` | Registry, clones, prompts, runtime, and local indexes |
| Agentic Workflows | Issue-driven reads and controlled writes |

## Data

- `sources/` holds evidence and provenance.
- `concepts/` holds compiled, cited knowledge.
- `queries/` holds reusable generated answers.
- `_Index.md`, `_index/`, and `_Sidebar.md` provide navigation.

Tags and namespaces may be declared in page metadata; namespaces also follow paths and dotted filenames.

## Indexes

The shared branch contains pairs only:

```text
.wikikb-cache/v1/indexes/<index>.manifest.json
.wikikb-cache/v1/indexes/<index>.tar.gz
```

Each manifest binds an archive containing a single SQLite index file to exact Markdown, namespace, indexing contract, runtime, size, and checksums. Snapshots are parentless, pushed with `--force-with-lease`, retain at most eight indexes, and contain no Markdown.

Reads sync pending commits, digest the selected Markdown, then reuse, restore, or fully rebuild an index. A new index is shared only after its Markdown is remote. Retrieval stops on any runtime, output, integrity, or empty-context failure.

Writes normalize a file, public HTTPS URL, or issue into `sources/`, stage only operation-owned paths, and push unless `--no-push` is set. URL redirects are revalidated, private/local destinations are rejected, explicit titles are honored, and same-title sources cannot overwrite each other. A requested push must reach the wiki or the command fails; uncommitted content cannot enter the shared cache.

Issue-form ingestion accepts public HTTPS URLs or pasted content and routes
them through the same `wkb ingest` implementation. The repository itself does
not maintain source inbox or archive directories; normalized pages in the wiki
are the durable knowledge-base content.

## Boundaries

Git credentials use process-local headers and never enter cached remotes. AI provider and model selection are explicit; credentials authenticate the selected provider and never choose one. `WIKIKB_LLM_COMMAND` is trusted shell configuration.

Pages, issues, URLs, and model output are untrusted. Copilot and OpenAI-compatible calls expose no tools and accept text only. Agentic Workflow models likewise receive no direct Bash, GitHub, or network tools; constrained jobs consume their declared safe outputs. Install those workflows only in a private repository with trusted collaborators. URL ingestion permits public HTTPS destinations only by default, and deletion does not erase Git history.

Cache hashes detect corruption or substitution after publication but do not
authenticate a wiki writer. Repository and wiki write access are the security
boundary. The repository mirror sync opens or updates a pull request instead of
pushing directly to the default branch.

Agentic Workflow Markdown is source; generated `*.lock.yml` files are committed artifacts. See [Release Scope](release-scope.md).
