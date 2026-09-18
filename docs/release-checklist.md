# Release Checklist

WikiKB ships one allowlisted CLI + Agentic Workflows archive. Release from a clean Node.js 22+ checkout after confirming [Release Scope](release-scope.md) and matching versions in `package.json`, `package-lock.json`, and CLI source.

## Automated Gate

```bash
npm ci
npm run release:check
```

This command includes the mandatory live suite. Configure the private disposable test repository and both tokens described below before running it. Missing live configuration is a release failure, never a skip.

```bash
gh extension install github/gh-aw --pin v0.83.4
gh aw compile
gh aw validate
actionlint
shellcheck tools/kb-search.sh tools/wikikb-local/install.sh tools/wikikb-local/wkb
```

Commit generated `*.lock.yml` and `.github/aw/actions-lock.json`; never hand-edit them.

## Live Gate

Use only an initialized, private, disposable repository with the current workflows installed:

```bash
cp tests/integration/.env.example .env
gh auth status
npm run test:wkb:integration
```

Set `WIKIKB_TEST_REPO` in `.env` or the process environment. Explicit
`WIKIKB_INTEGRATION_TOKEN` and `WIKIKB_COPILOT_TOKEN` values override the
active `gh auth token`; local runs obtain that CLI credential automatically
when either override is absent.

The suite always runs writes, deployed issue/file workflows, a fresh full LexCAT index build, an explicitly selected Copilot request, cache invalidation/restoration, and cleanup. Confirm the cleanup push; test commits remain in history.

The hosted `Live Integration` and `Release` workflows use the same mandatory
suite. Configure the WikiKB source repository with the Actions variable
`WIKIKB_TEST_REPO` and the Actions secrets `WIKIKB_INTEGRATION_TOKEN` and
`WIKIKB_COPILOT_TOKEN`. An unset value fails the workflow; there is no
hosted credential fallback or skip path. The integration token is test-only:
it must write the private test repository and its wiki and trigger/check its
workflows. The Copilot token is used only for the explicit text-only provider
check. GitHub's job token cannot replace the integration secret because it is
scoped to the WikiKB source repository.

## Review

- No credentials or private fixtures appear in caches, logs, or artifacts.
- `wikikb-cache-v1` is parentless, bounded, Markdown-free, and checksum-valid.
- Runtime archives contain only manifest-declared executables.
- Workflow permissions and safe outputs remain narrow.
- Agent models have no direct Bash, GitHub, or network tools.
- The integration repository is private and every integration test ran with zero skips.
- `INSTALL.md` can install and build WikiKB without replacing a target repository's root package.
- Audit findings are resolved or recorded.

## Publish

```bash
npm run package:release
cd release
shasum -a 256 -c *.sha256
tar -tzf *.tar.gz
git tag -a v0.1.0 -m "WikiKB v0.1.0"
git push origin v0.1.0
```

Verify the attachment, checksum, CI, release notes, fresh install, and one live query. Record the commit, tag, URL, checks, and residual risks. Never move a published tag silently; rotate exposed credentials before repairing artifacts or history.
