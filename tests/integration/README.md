# Integration Tests

The integration suite is live, destructive to its own fixtures, and mandatory
for release. It has no conditional skips. Missing credentials, a missing
runtime, an absent workflow, or an unsuitable repository fails before or during
the suite.

Use an initialized, private, disposable repository whose name contains `test`,
`testing`, `fixture`, `sandbox`, or `disposable`:

```bash
cp tests/integration/.env.example .env
gh auth status
npm run test:wkb:integration
```

The example sets `WIKIKB_TEST_REPO=githubnext/wikikb-test`; change it when
using a different private disposable repository. Root `.env` and
`tests/integration/.env` are loaded when present; process variables win, then
root `.env`, then the integration-specific file. When token overrides are
unset, the suite obtains the active credential from `gh auth token` for both
repository access and the explicit Copilot check.
`WIKIKB_ALLOW_ANY_TEST_REPO=1` bypasses only the disposable-name check. It does
not bypass the private-repository, wiki, permissions, workflow, or cleanup
requirements.

Before running, install the current WikiKB workflow sources and locks in the
test repository. Set its `COPILOT_GITHUB_TOKEN` Actions secret and keep the
repository private:

```bash
gh aw secrets bootstrap --non-interactive --engine copilot --repo owner/wikikb-test
```

Every run:

1. Verifies the repository is private, writable, wiki-enabled, and has all six workflows.
2. Creates a unique `integration.run-*` namespace.
3. Exercises all six issue-driven workflows: ingest, remember, search, text-only query, lint, and explore.
4. Tests local-only, file, URL, and GitHub-issue ingestion.
5. Confirms remote state from clean clients and restores the shared index.
6. Invalidates, republishes, and independently verifies the replacement index.
7. Runs every prompt task and an explicitly selected live Copilot generation.
8. Builds a fresh full LexCAT index in a clean cache.
9. Removes live pages and issues in the cleanup hook.

Cleanup removes current files, not Git history, and a killed process may prevent
cleanup. Inspect the repository and wiki after a failed run. Never target a
production repository or use real private knowledge as a fixture.

`npm run check:offline` runs non-live validation. `npm run check` and
`npm run release:check` include this mandatory live suite and therefore require
the environment above.

| Variable | Purpose |
| --- | --- |
| `WIKIKB_TEST_REPO` | Required private disposable `owner/repository` |
| `TEST_KB_NAME` | Optional temporary local name |
| `TEST_ISSUES_REPO` | Public issue source; defaults to `cli/cli` |
| `WIKIKB_INTEGRATION_TOKEN` | Optional test-only repository/wiki credential override; defaults to `gh auth token` locally |
| `WIKIKB_GITHUB_TOKEN` | Backward-compatible repository credential override |
| `WIKIKB_COPILOT_TOKEN` | Optional local Copilot credential override; defaults to `gh auth token` |
| `WIKIKB_AI_MODEL` | Copilot model; defaults to `claude-sonnet-4.6` |
| `WIKIKB_LEXCAT_BIN` | Controlled runtime override |
| `WIKIKB_ALLOW_ANY_TEST_REPO` | Explicitly bypass only the disposable-name guard |
