# Configuration

The registry maps a short name to an `owner/repository` slug. For AI selection, command-line options override environment variables, which override saved user configuration.

## Core

| Variable | Default | Purpose |
| --- | --- | --- |
| `WIKIKB_GITHUB_TOKEN` | none | Preferred GitHub token |
| `GITHUB_TOKEN` | none | Secondary GitHub token |
| `WIKIKB_GITHUB_API_URL` | `https://api.github.com` | GitHub API base URL |
| `WIKIKB_CACHE_DIR` | `~/.wikikb` | Registry, clones, prompts, runtime, and indexes |
| `WIKIKB_FETCH_TIMEOUT_MS` | `30000` | URL and GitHub API timeout |
| `WIKIKB_MAX_SOURCE_BYTES` | `5242880` | Maximum decoded response size |
| `WIKIKB_ALLOW_PRIVATE_URLS` | unset | Test-only override allowing HTTP/private URL fixtures; never set in workflows |
| `WIKIKB_LEXCAT_BIN` | vendored executable | Controlled runtime override |
| `WIKIKB_PROMPTS_DIR` | `~/.wikikb/prompts` | Prompt overrides |
| `WIKIKB_PROMPT_CHUNK_CHARS` | `6000` | Per-chunk prompt limit |
| `WIKIKB_TARGET` | none | Target used by `tools/kb-search.sh` |
| `WKB_INSTALL_DIR` | `~/.local/bin` | Launcher destination |

```bash
export WIKIKB_GITHUB_TOKEN="$(gh auth token)"
wkb add project owner/repository
```

Tokens stay in the process and never enter cached remotes. Public reads may be anonymous; private reads and all writes require repository access.

## AI

AI generation is optional, but generation commands (`query`, `summarize`, `rewrite`, `extract`, and `timeline`) require an explicitly selected provider and model. `search` is always retrieval-only. Credentials authenticate a provider; credential presence never selects one.

Configure the user default once:

```bash
wkb config set ai.provider copilot
wkb config set ai.model claude-sonnet-4.6
```

WikiKB uses `WIKIKB_COPILOT_TOKEN` when explicitly set, then
`COPILOT_GITHUB_TOKEN`, and otherwise obtains the active credential by running
`gh auth token`. Use `gh auth switch` when the wrong account is active. Local
authentication is separate from the fine-grained `COPILOT_GITHUB_TOKEN` secret
required by Agentic Workflows.

Inspect or change saved defaults with:

```bash
wkb config list
wkb config get ai.provider
wkb config set ai.provider copilot
wkb config set ai.model claude-sonnet-4.6
wkb config unset ai.model
```

Selection is deterministic: `--provider`/`--model` override `WIKIKB_AI_PROVIDER`/`WIKIKB_AI_MODEL`, which override the user configuration. Values are never inferred from available tokens. Supported providers are `copilot`, `openai`, and `command`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WIKIKB_AI_PROVIDER` | configured value | `copilot`, `openai`, or `command` |
| `WIKIKB_AI_MODEL` | configured value | Generation model name |
| `WIKIKB_COPILOT_TOKEN` | active `gh` credential | Preferred explicit Copilot token override |
| `COPILOT_GITHUB_TOKEN` | active `gh` credential | Secondary explicit Copilot token override |
| `WIKIKB_COPILOT_API_URL` | `https://api.githubcopilot.com` | Copilot API base URL |
| `WIKIKB_COPILOT_API` | `auto` | `auto`, `chat`, or `responses` |
| `WIKIKB_LLM_COMMAND` | none | Trusted command reading JSON on stdin |
| `WIKIKB_LLM_TIMEOUT_MS` | `180000` | AI request timeout |
| `WIKIKB_OPENAI_API_KEY` | none | Preferred OpenAI-compatible token |
| `OPENAI_API_KEY` | none | Secondary OpenAI-compatible token |
| `WIKIKB_OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL |

Use `--provider` and `--model` for a one-off override:

```bash
wkb project query "What changed?" --provider copilot --model claude-sonnet-4.6
```

For an OpenAI-compatible endpoint, select `openai`, choose a model, and set `WIKIKB_OPENAI_API_KEY`; set `WIKIKB_OPENAI_BASE_URL` only when using a non-default endpoint. For a local adapter, select `command`, choose the model name passed in the request, and set `WIKIKB_LLM_COMMAND` to a trusted executable that reads one JSON request from standard input and writes the answer to standard output.

`--show-prompt` retrieves and displays the complete prompt without calling a provider. It cannot be combined with `--rewrite-query`, because rewriting requires an AI call. Manage prompt copies with `wkb prompts init`, `list`, `show`, and `path`.

Copilot and OpenAI-compatible generation requests deliberately omit `tools` and
`tool_choice`; only text is accepted. A provider response containing a function
or tool call is rejected. Retrieved entries and user content are marked as
untrusted data in every generated prompt. The `command` provider is an explicit
local trust boundary: WikiKB cannot constrain what the configured executable
does, so configure only a command you control.

## Runtime And Cache

LexCAT is mandatory. WikiKB verifies and extracts the matching executable from `vendor/lexcat/`; it never downloads a runtime.

LexCAT is model-free lexical BM25 retrieval. It downloads no model, performs no embedding step, and needs no network at query time. Supported vendored platforms are `linux/x64`, `linux/arm64`, `darwin/arm64`, `darwin/x64`, and `win32/x64`; `win32/arm64` runs the `win32/x64` build under emulation. Unsupported hosts fail with guidance to set `WIKIKB_LEXCAT_BIN` to an operator-approved executable.

Wiki identity travels with the corpus as YAML frontmatter, which LexCAT strips from the indexed text and returns on every chunk of a document, so retrieval reads titles, wiki paths, and chunk text straight out of `lexcat query --json`. An index built by the current contract is refreshed with `lexcat sync`, which reconciles only added, changed, and removed documents; `wkb <kb> index --force` always rebuilds from scratch.

Indexing runs `build`/`sync` with `--json` and requires the reported chunk **and** term counts to be non-zero. Neither an empty corpus nor a vocabulary the analyzer collapsed to nothing is an error to LexCAT — both produce a valid index that answers every later query with no hits at exit 0 — so an index that cannot be searched is rejected when it is built rather than silently at query time.

The parentless `wikikb-cache-v1` branch stores at most eight indexes plus integrity manifests and no Markdown. Restore validates source, runtime, paths, size, and checksums. These checks prove integrity, not authorship: anyone allowed to write the private wiki is inside the cache trust boundary. A requested push that remains unpublished fails the command.

## Live Tests

Live variables and repository guards are in [Integration Tests](../tests/integration/README.md). The live suite never skips tests and explicitly selects the Copilot provider for generation.
