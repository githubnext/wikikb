# Agent Memory

WikiKB turns Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern into shared, repository-backed agent memory.

## Rules

1. Recall before answering project questions.
2. Separate evidence, compiled concepts, and generated answers.
3. Cite page paths or issue URLs.
4. Store only durable, non-sensitive findings.
5. Name every artifact written.
6. State when recall is unavailable or inconclusive.

## Recall

```bash
wkb project search "release blockers" --top 5
wkb project.decisions search "What did we decide?"
```

Use `query` only for a generated answer. It requires an explicit AI provider and model; `search` never calls a generation provider. See [Configuration](configuration.md).

LexCAT is the only retrieval backend. It performs model-free lexical BM25 retrieval. `queries/` pages remain generated claims; verify them against cited sources or concepts.

## Write

Use `kb-remember` for durable issue knowledge, `kb-ingest` or `wkb ... ingest` for evidence, and `kb-question` for answers worth filing under `queries/`.

```bash
wkb project.decisions ingest ./decision.md --tag decision,release
wkb project.github.issues ingest-issues owner/repo --state all --comments
```

Without remote-write authorization, use `--no-push` and report the uncommitted path. It cannot enter the shared index.

## Failure Rules

- Nonzero means incomplete; runtime failures stop retrieval.
- A requested push that cannot be published returns nonzero; use `--no-push` deliberately for local-only work.
- Missing AI credentials do not affect `search`; generation commands fail with setup guidance.
- Empty retrieval is not evidence that a claim is false.

Tokens are configuration, never memory. Do not put secrets in pages, prompts, issues, logs, or remotes.
