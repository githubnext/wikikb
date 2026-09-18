import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import test, { after } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const wkb = join(repoRoot, "tools/wikikb-local/wkb");
const lexcatManifest = JSON.parse(readFileSync(join(repoRoot, "vendor", "lexcat", "manifest.json"), "utf8"));

loadDotEnv(join(repoRoot, ".env"));
loadDotEnv(join(repoRoot, "tests/integration/.env"));

const needsGitHubCliToken =
  !(process.env.WIKIKB_INTEGRATION_TOKEN || process.env.WIKIKB_GITHUB_TOKEN) ||
  !process.env.WIKIKB_COPILOT_TOKEN;
const githubCliToken = needsGitHubCliToken ? readGitHubCliToken() : "";
const slug = process.env.WIKIKB_TEST_REPO || "";
const kbName = process.env.TEST_KB_NAME || "test-kb";
const verificationKbName = `${kbName}-verify`;
const token = (process.env.WIKIKB_INTEGRATION_TOKEN || process.env.WIKIKB_GITHUB_TOKEN || githubCliToken).trim();
const copilotToken = (process.env.WIKIKB_COPILOT_TOKEN || githubCliToken).trim();
const disposableName = slug.split("/")[1] || "";
const looksDisposable = /(?:^|[-_.])(test|testing|fixture|sandbox|disposable)(?:$|[-_.])/i.test(disposableName);
const hasLexcat = detectLexcat();

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug)) {
  throw new Error("WikiKB integration tests require WIKIKB_TEST_REPO=owner/repository in the environment or .env");
}
if (!token) throw new Error("WikiKB integration tests require WIKIKB_INTEGRATION_TOKEN, WIKIKB_GITHUB_TOKEN, or an authenticated gh CLI");
if (!copilotToken) throw new Error("WikiKB integration tests require WIKIKB_COPILOT_TOKEN or an authenticated gh CLI");
if (!looksDisposable && process.env.WIKIKB_ALLOW_ANY_TEST_REPO !== "1") {
  throw new Error("WIKIKB_TEST_REPO must have test, fixture, sandbox, or disposable in its name (or explicitly set WIKIKB_ALLOW_ANY_TEST_REPO=1)");
}
if (!hasLexcat) throw new Error(`The vendored LexCAT runtime is unavailable for ${process.platform}/${process.arch}`);
const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-integration-"));
const verificationCacheDir = mkdtempSync(join(tmpdir(), "wikikb-integration-verify-"));
const sharedCacheVerificationDir = mkdtempSync(join(tmpdir(), "wikikb-integration-shared-"));
const invalidationCacheDir = mkdtempSync(join(tmpdir(), "wikikb-integration-invalidation-"));
const runtimeBootstrapCacheDir = mkdtempSync(join(tmpdir(), "wikikb-integration-runtime-"));
const runId = `run-${Date.now().toString(36)}-${process.pid}`;
const namespace = ["integration", runId];
const namespaceKey = namespace.join(".");
const namespaceRel = join("sources", ...namespace);
const liveTarget = `${kbName}.${namespaceKey}`;
const verificationTarget = `${verificationKbName}.${namespaceKey}`;
const marker = `wikikb${Date.now()}marker`;
const mutationMarker = `${marker}mutation`;
const draftTitle = `Integration Draft ${runId}`;
const publishedTitle = `Integration Published ${runId}`;
const urlTitle = `Integration URL ${runId}`;
const issueSourceRepo = process.env.TEST_ISSUES_REPO || "cli/cli";
let liveReady = false;
let verificationReady = false;
let liveWriteTouched = false;
const issueWorkflowMarkers = [];
const issueWorkflowIssueNumbers = [];


function env(extra = {}, selectedCache = cacheDir) {
  return {
    ...process.env,
    WIKIKB_CACHE_DIR: selectedCache,
    WIKIKB_GITHUB_TOKEN: token,
    COPILOT_GITHUB_TOKEN: "",
    GH_TOKEN: token,
    GITHUB_TOKEN: token,
    GIT_AUTHOR_NAME: "WikiKB Integration Test",
    GIT_AUTHOR_EMAIL: "wikikb-integration@example.invalid",
    GIT_COMMITTER_NAME: "WikiKB Integration Test",
    GIT_COMMITTER_EMAIL: "wikikb-integration@example.invalid",
    ...extra,
  };
}

function run(args, { timeout = 120_000, extraEnv = {}, cache = cacheDir } = {}) {
  const result = spawnSync(wkb, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: env(extraEnv, cache),
    timeout,
  });
  return { ...result, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function runOk(args, options) {
  const result = run(args, options);
  assert.equal(result.status, 0, `${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

async function githubApi(path, { method = "GET", body } = {}) {
  const attempts = ["GET", "DELETE", "PATCH"].includes(method) ? 3 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "wikikb-integration-tests",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      if (response.ok) return text ? JSON.parse(text) : undefined;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === attempts) {
        throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
      }
    } catch (error) {
      if (attempt === attempts || /failed \(\d+\):/.test(String(error))) throw error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 500));
  }
  throw new Error(`${method} ${path} failed after ${attempts} attempts`);
}

async function ensureIssueLabel(name, color, description) {
  const labelPath = `/repos/${slug}/labels/${encodeURIComponent(name)}`;
  try {
    await githubApi(labelPath);
  } catch (error) {
    if (!String(error).includes("(404)")) throw error;
    await githubApi(`/repos/${slug}/labels`, { method: "POST", body: { name, color, description } });
  }
}

async function issueWorkflowRunIds() {
  const result = await githubApi(`/repos/${slug}/actions/runs?event=issues&per_page=100`);
  return result.workflow_runs.map((run) => run.id);
}

async function createWorkflowIssue(title, body, label) {
  const issue = await githubApi(`/repos/${slug}/issues`, {
    method: "POST",
    body: { title, body },
  });
  const priorWorkflowRunIds = await issueWorkflowRunIds();
  const labelStartedAt = Date.now();
  await githubApi(`/repos/${slug}/issues/${issue.number}/labels`, {
    method: "POST",
    body: { labels: [label] },
  });
  return { ...issue, labelStartedAt, priorWorkflowRunIds };
}

async function waitForIssueWorkflow(issue, workflowName, { conclusion = "success", timeout = 15 * 60_000 } = {}) {
  const started = (issue.labelStartedAt || Date.parse(issue.created_at)) - 2000;
  const priorWorkflowRunIds = new Set(issue.priorWorkflowRunIds || []);
  const deadline = Date.now() + timeout;
  let observed;
  while (Date.now() < deadline) {
    const result = await githubApi(`/repos/${slug}/actions/runs?event=issues&per_page=50`);
    const candidates = result.workflow_runs.filter((run) =>
      run.name === workflowName &&
      Date.parse(run.created_at) >= started &&
      !priorWorkflowRunIds.has(run.id)
    );
    const expected = candidates.find((run) => run.status === "completed" && run.conclusion === conclusion);
    if (expected) return expected;
    observed = candidates.find((run) => run.status !== "completed") || candidates[0];
    if (candidates.length > 0 && candidates.every((run) => run.status === "completed")) {
      throw new Error(`${workflowName} did not conclude ${conclusion}: ${candidates.map((run) => `${run.conclusion} ${run.html_url}`).join(", ")}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10_000));
  }
  throw new Error(`Timed out waiting for ${workflowName} to conclude ${conclusion}; last run: ${observed?.html_url || "none"}`);
}

async function waitForIssueResult(issueNumber, marker, { timeout = 2 * 60_000 } = {}) {
  const deadline = Date.now() + timeout;
  let issue;
  let comments = [];
  while (Date.now() < deadline) {
    [issue, comments] = await Promise.all([
      githubApi(`/repos/${slug}/issues/${issueNumber}`),
      githubApi(`/repos/${slug}/issues/${issueNumber}/comments?per_page=100`),
    ]);
    if (issue.state === "closed" && comments.some((comment) => comment.body.includes(marker))) {
      return { issue, comments };
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5000));
  }
  throw new Error(`Issue #${issueNumber} did not close with marker ${marker}; state=${issue?.state}, comments=${comments.length}`);
}

async function waitForIssueComment(issueNumber, marker, { timeout = 5 * 60_000 } = {}) {
  const deadline = Date.now() + timeout;
  let comments = [];
  while (Date.now() < deadline) {
    comments = await githubApi(`/repos/${slug}/issues/${issueNumber}/comments?per_page=100`);
    if (comments.some((comment) => comment.body.includes(marker))) return comments;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5000));
  }
  throw new Error(`Issue #${issueNumber} did not receive a comment containing ${marker}; comments=${comments.length}`);
}

function ensureLiveKb() {
  if (liveReady) return;
  runOk(["add", kbName, slug]);
  runOk([kbName, "sync"], { timeout: 180_000 });
  liveReady = true;
}

function liveWikiContains(expectedMarker) {
  ensureLiveKb();
  runOk([kbName, "sync"], { timeout: 180_000 });
  const wikiDir = join(cacheDir, kbName, "wiki");
  let found = false;

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (found || entry.name === ".git") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".md") && readFileSync(path, "utf8").includes(expectedMarker)) found = true;
    }
  }

  visit(wikiDir);
  return found;
}

function ensureVerificationKb() {
  if (!verificationReady) {
    runOk(["add", verificationKbName, slug], { cache: verificationCacheDir });
    runOk([verificationKbName, "sync"], { cache: verificationCacheDir, timeout: 180_000 });
    verificationReady = true;
    return;
  }
  runOk([verificationKbName, "sync"], { cache: verificationCacheDir, timeout: 180_000 });
}

function startHttpFixture(title, body) {
  const fixtureDir = mkdtempSync(join(tmpdir(), "wikikb-live-http-"));
  const serverScript = join(fixtureDir, "server.cjs");
  const portFile = join(fixtureDir, "port");
  writeFileSync(
    serverScript,
    `const fs = require("node:fs");
const http = require("node:http");
const content = ${JSON.stringify(`# ${title}\n\n${body}\n`)};
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
  response.end(content);
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(process.argv[2], String(server.address().port)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
  );
  const processHandle = spawn(process.execPath, [serverScript, portFile], { stdio: "ignore" });
  const deadline = Date.now() + 5000;
  while (!existsSync(portFile) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  assert.ok(existsSync(portFile), "live HTTP fixture did not start");
  return {
    url: `http://127.0.0.1:${readFileSync(portFile, "utf8").trim()}/article`,
    stop() {
      processHandle.kill("SIGTERM");
      rmSync(fixtureDir, { recursive: true, force: true });
    },
  };
}

function detectLexcat() {
  const override = process.env.WIKIKB_LEXCAT_BIN;
  if (override) return existsSync(override);
  const vendorDir = join(repoRoot, "vendor", "lexcat");
  try {
    const manifest = JSON.parse(readFileSync(join(vendorDir, "manifest.json"), "utf8"));
    const artifact = manifest.artifacts.find((candidate) => candidate.platform === process.platform && candidate.arch === process.arch);
    return Boolean(artifact && existsSync(join(vendorDir, artifact.archive)));
  } catch {
    return false;
  }
}

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function readGitHubCliToken() {
  const result = spawnSync("gh", ["auth", "token"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) return "";
  return (result.stdout || "").trim();
}

function gitChecked(args, cwd, gitEnv = process.env) {
  const result = spawnSync("git", args, { cwd, env: gitEnv, encoding: "utf8", timeout: 120_000 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function cleanupLiveNamespace() {
  if (!liveWriteTouched) return;
  const wikiDir = join(cacheDir, kbName, "wiki");
  if (!existsSync(join(wikiDir, ".git"))) return;
  rmSync(join(wikiDir, namespaceRel), { recursive: true, force: true });
  gitChecked(["add", "-A", "--", namespaceRel], wikiDir);
  const diff = spawnSync("git", ["diff", "--cached", "--quiet", "--", namespaceRel], { cwd: wikiDir });
  if (diff.status === 1) {
    gitChecked(["commit", "-m", `test: clean WikiKB integration namespace ${runId}`, "--", namespaceRel], wikiDir, env());
  } else if (diff.status !== 0) {
    throw new Error("Could not inspect live integration cleanup changes");
  }
  const credentials = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  gitChecked(["push"], wikiDir, {
    ...env(),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${credentials}`,
    GIT_TERMINAL_PROMPT: "0",
  });
}

function cleanupIssueWorkflowPages() {
  if (issueWorkflowMarkers.length === 0) return;
  ensureLiveKb();
  runOk([kbName, "sync"], { timeout: 180_000 });
  const wikiDir = join(cacheDir, kbName, "wiki");
  const matches = [];

  function visit(directory, relativeDirectory = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const relativePath = join(relativeDirectory, entry.name);
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath, relativePath);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        const body = readFileSync(absolutePath, "utf8");
        if (issueWorkflowMarkers.some((marker) => body.includes(marker))) matches.push(relativePath);
      }
    }
  }

  visit(wikiDir);
  if (matches.length === 0) return;
  for (const match of matches) rmSync(join(wikiDir, match));
  gitChecked(["add", "-A", "--", ...matches], wikiDir);
  gitChecked(["commit", "-m", "test: clean WikiKB issue workflow pages", "--", ...matches], wikiDir, env());
  const credentials = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  gitChecked(["push"], wikiDir, {
    ...env(),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${credentials}`,
    GIT_TERMINAL_PROMPT: "0",
  });
}

after(async () => {
  let cleanupError;
  try {
    cleanupLiveNamespace();
    cleanupIssueWorkflowPages();
    for (const issueNumber of issueWorkflowIssueNumbers) {
      const issue = await githubApi(`/repos/${slug}/issues/${issueNumber}`);
      if (issue.state !== "closed") {
        await githubApi(`/repos/${slug}/issues/${issueNumber}`, { method: "PATCH", body: { state: "closed", state_reason: "not_planned" } });
      }
    }
  } catch (error) {
    cleanupError = error;
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
    rmSync(verificationCacheDir, { recursive: true, force: true });
    rmSync(sharedCacheVerificationDir, { recursive: true, force: true });
    rmSync(invalidationCacheDir, { recursive: true, force: true });
    rmSync(modelBootstrapCacheDir, { recursive: true, force: true });
  }
  if (cleanupError) throw cleanupError;
});

test("registry, help, and status commands work without network", () => {
  runOk(["add", kbName, slug]);
  runOk(["add", "other-kb", "octocat/Hello-World"]);

  const list = runOk(["list"]);
  assert.match(list.stdout, new RegExp(kbName));
  assert.match(list.stdout, new RegExp(slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(list.stdout, /other-kb/);

  const help = runOk(["--help"]);
  assert.match(help.stdout, /WIKIKB_GITHUB_TOKEN/);
  assert.match(help.stdout, /Query options:/);

  const status = runOk([kbName, "status"]);
  assert.match(status.stdout, /not synced|Pages:/i);
});

test("invalid commands fail clearly", () => {
  assert.notEqual(run(["add"]).status, 0);
  assert.notEqual(run(["add", "bad.name", slug]).status, 0);
  assert.notEqual(run(["add", "bad-slug", ""]).status, 0);

  const unknownKb = run(["missing-kb", "sync"]);
  assert.notEqual(unknownKb.status, 0);
  assert.match(unknownKb.stderr, /Unknown knowledge base/);

  runOk(["add", kbName, slug]);
  const unknownCommand = run([kbName, "badcmd"]);
  assert.notEqual(unknownCommand.status, 0);
  assert.match(unknownCommand.stderr, /Unknown command/);

  const undocumentedAlias = run([kbName, "issues"]);
  assert.notEqual(undocumentedAlias.status, 0);
  assert.match(undocumentedAlias.stderr, /Unknown command/);
});

test("the mandatory integration repository is private, writable, and has every deployed workflow", async () => {
  const repository = await githubApi(`/repos/${slug}`);
  assert.equal(repository.private, true, "WIKIKB_TEST_REPO must be private because Agentic Workflows process untrusted KB content");
  assert.equal(repository.has_wiki, true, "WIKIKB_TEST_REPO must have its GitHub wiki enabled");
  assert.ok(repository.permissions?.push || repository.permissions?.admin, "The integration credential must be able to write WIKIKB_TEST_REPO");
  const workflows = await githubApi(`/repos/${slug}/actions/workflows?per_page=100`);
  for (const name of [
    "Compile Knowledge Base",
    "Explore Knowledge Base",
    "Lint Knowledge Base",
    "Query Knowledge Base",
    "Remember Knowledge",
    "Search Knowledge Base",
  ]) {
    assert.ok(workflows.workflows.some((workflow) => workflow.name === name), `WIKIKB_TEST_REPO is missing deployed workflow: ${name}`);
  }
  for (const workflow of ["compile-kb", "explore-kb", "lint-kb", "query-kb", "remember-kb", "search-kb"]) {
    const deployed = await githubApi(`/repos/${slug}/contents/.github/workflows/${workflow}.lock.yml`);
    assert.equal(deployed.type, "file", `WIKIKB_TEST_REPO is missing .github/workflows/${workflow}.lock.yml`);
    const body = Buffer.from(String(deployed.content || "").replace(/\n/g, ""), "base64").toString("utf8");
    const localBody = readFileSync(join(repoRoot, ".github", "workflows", `${workflow}.lock.yml`), "utf8");
    assert.equal(body, localBody, `${workflow}.lock.yml in WIKIKB_TEST_REPO is stale or differs from the release candidate`);
    assert.match(body, /"compiler_version":"v0\.83\.4"/, `${workflow} was not compiled with the release-tested gh-aw version`);
    assert.match(body, /--available-tools=safeoutputs/, `${workflow} does not restrict the visible tool set`);
    assert.match(body, /--deny-tool=write/, `${workflow} does not deny model file writes`);
    assert.match(body, /GH_AW_REQUIRED_ROLES: "admin,maintainer,write"/, `${workflow} does not enforce the required repository roles`);
    assert.match(body, /check_membership\.cjs/, `${workflow} does not perform the compiled membership check`);
    assert.doesNotMatch(body, /34e114876b0b11c390a56381ad16ebd13914f8d5|49933ea5288caeca8642d1e84afbd3f7d6820020/, `${workflow} still uses a deprecated action generation`);
    assert.doesNotMatch(body, /github-mcp-server|--allow-tool shell|--allow-all-tools|--allow-all-paths|\n  detection:\n/, `${workflow} exposes a forbidden model capability`);
  }
  for (const workflow of ["index-wiki.yml", "init-wiki.yml", "sync-labels.yml", "sync-wiki.yml"]) {
    const deployed = await githubApi(`/repos/${slug}/contents/.github/workflows/${workflow}`);
    assert.equal(deployed.type, "file", `WIKIKB_TEST_REPO is missing .github/workflows/${workflow}`);
    const body = Buffer.from(String(deployed.content || "").replace(/\n/g, ""), "base64").toString("utf8");
    let localBody = readFileSync(join(repoRoot, ".github", "workflows", workflow), "utf8");
    if (workflow === "sync-labels.yml" && repository.default_branch !== "main") {
      localBody = localBody.replace("branches: [main]", `branches: [${JSON.stringify(repository.default_branch)}]`);
    }
    assert.equal(body, localBody, `${workflow} in WIKIKB_TEST_REPO is stale or differs from the release candidate`);
    assert.doesNotMatch(body, /34e114876b0b11c390a56381ad16ebd13914f8d5|49933ea5288caeca8642d1e84afbd3f7d6820020/, `${workflow} still uses a deprecated action generation`);
  }
});

test("read-only CLI commands work against a live wiki", () => {
  ensureLiveKb();
  const status = runOk([kbName, "status"]);
  assert.match(status.stdout, /Pages:/);

  const lint = runOk([kbName, "lint"]);
  assert.match(lint.stdout, /Pages:/);
  assert.match(lint.stdout, /Links:/);

  const explore = runOk([kbName, "explore"], { timeout: 180_000 });
  assert.match(explore.stdout, /Exploration Report/);
  runOk([kbName, "tags"]);
});

test("GitHub issues drive all six deployed Agentic Workflows", {
  timeout: 45 * 60_000,
}, async () => {
  const issueMarker = `wikikb-issue-workflow-${runId}`;
  issueWorkflowMarkers.push(issueMarker);
  await Promise.all([
    ensureIssueLabel("kb-ingest", "1d76db", "Ingest source material into the wiki"),
    ensureIssueLabel("kb-remember", "8250df", "Store durable knowledge in the wiki"),
    ensureIssueLabel("kb-search", "0e8a16", "Search the wiki knowledge base"),
    ensureIssueLabel("kb-question", "5319e7", "Ask a question against the wiki knowledge base"),
    ensureIssueLabel("kb-lint", "e11d48", "Run a health check over the wiki knowledge base"),
    ensureIssueLabel("kb-explore", "16a34a", "Report gaps and follow-up questions in the wiki knowledge base"),
  ]);

  const ingestMarker = `wikikb-ingest-workflow-${runId}`;
  const secondIngestMarker = `wikikb-ingest-same-title-${runId}`;
  issueWorkflowMarkers.push(ingestMarker);
  issueWorkflowMarkers.push(secondIngestMarker);
  const sharedIngestTitle = `Integration issue-form source ${runId}`;
  const ingest = await createWorkflowIssue(
    `[integration] Ingest ${ingestMarker}`,
    `### URL (optional)\n\n_No response_\n\n### Pasted content (optional)\n\n${ingestMarker}\n\nIngest this issue-form text through wkb and preserve the marker above.\n\n### Title (optional)\n\n${sharedIngestTitle}`,
    "kb-ingest",
  );
  issueWorkflowIssueNumbers.push(ingest.number);
  await waitForIssueWorkflow(ingest, "Compile Knowledge Base");
  await waitForIssueResult(ingest.number, "WikiKB ingested the requested sources");

  const secondIngest = await createWorkflowIssue(
    `[integration] Ingest same title ${secondIngestMarker}`,
    `### URL (optional)\n\n_No response_\n\n### Pasted content (optional)\n\n${secondIngestMarker}\n\nThis separate issue deliberately reuses a title and must preserve the marker above.\n\n### Title (optional)\n\n${sharedIngestTitle}`,
    "kb-ingest",
  );
  issueWorkflowIssueNumbers.push(secondIngest.number);
  await waitForIssueWorkflow(secondIngest, "Compile Knowledge Base");
  await waitForIssueResult(secondIngest.number, "WikiKB ingested the requested sources");

  const secondMemoryMarker = `wikikb-remember-same-title-${runId}`;
  issueWorkflowMarkers.push(secondMemoryMarker);
  const sharedMemoryTitle = `Integration issue-form memory ${runId}`;
  const remember = await createWorkflowIssue(
    `[integration] Remember ${issueMarker}`,
    `### Title\n\n${sharedMemoryTitle}\n\n### Kind\n\nfinding\n\n### Namespace\n\nintegration.${runId}\n\n### Tags\n\nintegration,release\n\n### Memory\n\nRemember this exact integration-test fact: ${issueMarker}. Preserve the marker verbatim in the wiki page.\n\n### Sources\n\n- Live WikiKB issue-form integration test`,
    "kb-remember",
  );
  issueWorkflowIssueNumbers.push(remember.number);
  await waitForIssueWorkflow(remember, "Remember Knowledge");
  await waitForIssueResult(remember.number, "WikiKB stored the requested durable memory");

  const secondRemember = await createWorkflowIssue(
    `[integration] Remember same title ${secondMemoryMarker}`,
    `### Title\n\n${sharedMemoryTitle}\n\n### Kind\n\nfinding\n\n### Namespace\n\nintegration.${runId}\n\n### Tags\n\nintegration,release\n\n### Memory\n\nThis separate issue deliberately reuses a title and must preserve: ${secondMemoryMarker}\n\n### Sources\n\n- Live WikiKB same-title integration test`,
    "kb-remember",
  );
  issueWorkflowIssueNumbers.push(secondRemember.number);
  await waitForIssueWorkflow(secondRemember, "Remember Knowledge");
  await waitForIssueResult(secondRemember.number, "WikiKB stored the requested durable memory");

  for (const preservedMarker of [ingestMarker, secondIngestMarker, issueMarker, secondMemoryMarker]) {
    assert.equal(liveWikiContains(preservedMarker), true, `same-title workflow write lost ${preservedMarker}`);
  }

  const search = await createWorkflowIssue(
    `[integration] Search ingested source ${ingestMarker}`,
    `Search the knowledge base for the source ingested by the kb-ingest workflow and include its exact marker verbatim: ${ingestMarker}`,
    "kb-search",
  );
  issueWorkflowIssueNumbers.push(search.number);
  await waitForIssueWorkflow(search, "Search Knowledge Base", { timeout: 20 * 60_000 });
  await waitForIssueResult(search.number, ingestMarker);

  const question = await createWorkflowIssue(
    `[integration] Question ${ingestMarker}`,
    `What does the private knowledge base say about this exact marker: ${ingestMarker}? Include the marker verbatim.`,
    "kb-question",
  );
  issueWorkflowIssueNumbers.push(question.number);
  await waitForIssueWorkflow(question, "Query Knowledge Base", { timeout: 20 * 60_000 });
  await waitForIssueComment(question.number, ingestMarker);

  const lint = await createWorkflowIssue(
    `[integration] Lint private knowledge base ${runId}`,
    "Run the deterministic WikiKB health check and return its page and link counts.",
    "kb-lint",
  );
  issueWorkflowIssueNumbers.push(lint.number);
  await waitForIssueWorkflow(lint, "Lint Knowledge Base", { timeout: 20 * 60_000 });
  await waitForIssueResult(lint.number, "Pages:");

  const explore = await createWorkflowIssue(
    `[integration] Explore private knowledge base ${runId}`,
    "Run the deterministic WikiKB exploration report and return its follow-up questions.",
    "kb-explore",
  );
  issueWorkflowIssueNumbers.push(explore.number);
  await waitForIssueWorkflow(explore, "Explore Knowledge Base", { timeout: 20 * 60_000 });
  await waitForIssueResult(explore.number, "Exploration Report");
});

test("closed issues cannot activate any Agentic Workflow", {
  timeout: 15 * 60_000,
}, async () => {
  const workflows = [
    ["kb-ingest", "Compile Knowledge Base"],
    ["kb-explore", "Explore Knowledge Base"],
    ["kb-lint", "Lint Knowledge Base"],
    ["kb-question", "Query Knowledge Base"],
    ["kb-remember", "Remember Knowledge"],
    ["kb-search", "Search Knowledge Base"],
  ];

  for (const [label, workflowName] of workflows) {
    const issue = await githubApi(`/repos/${slug}/issues`, {
      method: "POST",
      body: {
        title: `[integration] Closed issue gate ${workflowName} ${runId}`,
        body: `This closed issue must not activate ${workflowName}.`,
      },
    });
    issueWorkflowIssueNumbers.push(issue.number);
    await githubApi(`/repos/${slug}/issues/${issue.number}`, {
      method: "PATCH",
      body: { state: "closed", state_reason: "not_planned" },
    });
    const priorWorkflowRunIds = await issueWorkflowRunIds();
    const labelStartedAt = Date.now();
    await githubApi(`/repos/${slug}/issues/${issue.number}/labels`, {
      method: "POST",
      body: { labels: [label] },
    });
    await waitForIssueWorkflow(
      { ...issue, labelStartedAt, priorWorkflowRunIds },
      workflowName,
      { conclusion: "skipped", timeout: 5 * 60_000 },
    );
  }
});

test("credential-shaped issue content is rejected without writing to the wiki", {
  timeout: 20 * 60_000,
}, async () => {
  await ensureIssueLabel("kb-ingest", "1d76db", "Ingest source material into the wiki");
  const sensitiveMarker = `wikikb-sensitive-rejection-${runId}`;
  issueWorkflowMarkers.push(sensitiveMarker);
  const issue = await createWorkflowIssue(
    `[integration] Reject sensitive content ${sensitiveMarker}`,
    `### Pasted content (optional)\n\nThis must be rejected. api_key=not-a-real-credential-${sensitiveMarker}\n\n### Title (optional)\n\nRejected integration source ${runId}`,
    "kb-ingest",
  );
  issueWorkflowIssueNumbers.push(issue.number);
  await waitForIssueWorkflow(issue, "Compile Knowledge Base", { conclusion: "failure" });

  const [currentIssue, comments] = await Promise.all([
    githubApi(`/repos/${slug}/issues/${issue.number}`),
    githubApi(`/repos/${slug}/issues/${issue.number}/comments?per_page=100`),
  ]);
  assert.equal(currentIssue.state, "open", "a rejected ingestion issue was closed as if it succeeded");
  assert.ok(!comments.some((comment) => comment.body.includes("WikiKB ingested the requested sources")), "a rejected ingestion issue received a success comment");
  assert.equal(liveWikiContains(sensitiveMarker), false, "credential-shaped issue content reached the wiki");
});

test("self-cleaning live round trip exercises CLI writes, reads, AI, and issues", () => {
  ensureLiveKb();
  const articleDir = mkdtempSync(join(tmpdir(), "wikikb-live-articles-"));
  const draft = join(articleDir, "draft.md");
  const published = join(articleDir, "published.md");
  writeFileSync(draft, `# ${draftTitle}\n\nThis local-only draft contains ${marker}.\n`);
  writeFileSync(published, `# ${publishedTitle}\n\nRemote release evidence contains ${marker} and validates the complete CLI round trip.\n`);

  const localOnly = runOk([liveTarget, "ingest", draft, "--no-push", "--tag", "integration,draft"]);
  assert.match(localOnly.stdout, /Left uncommitted/);
  liveWriteTouched = true;
  const pushed = runOk([liveTarget, "ingest", published, "--tag", "integration,release"], { timeout: 180_000 });
  assert.match(pushed.stdout, /Pushed to wiki/);

  const httpFixture = startHttpFixture(urlTitle, `URL ingestion evidence also contains ${marker}.`);
  try {
    const urlPush = runOk([liveTarget, "ingest", httpFixture.url, "--tag", "integration,url"], {
      timeout: 180_000,
      extraEnv: { WIKIKB_ALLOW_PRIVATE_URLS: "1" },
    });
    assert.match(urlPush.stdout, /Pushed to wiki/);
  } finally {
    httpFixture.stop();
  }

  const issues = runOk([
    liveTarget, "ingest-issues", issueSourceRepo, "--state", "all", "--limit", "1",
  ], { timeout: 180_000 });
  assert.match(issues.stdout, /Ingested 1 GitHub issue page/);
  assert.match(issues.stdout, /Pushed to wiki/);

  ensureVerificationKb();
  const verificationWiki = join(verificationCacheDir, verificationKbName, "wiki");
  const publishedName = `integration-published-${runId}.md`;
  const draftName = `integration-draft-${runId}.md`;
  const urlName = `integration-url-${runId}.md`;
  assert.ok(existsSync(join(verificationWiki, namespaceRel, publishedName)));
  assert.ok(existsSync(join(verificationWiki, namespaceRel, urlName)));
  assert.ok(!existsSync(join(verificationWiki, namespaceRel, draftName)), "--no-push draft reached the live remote");

  const issueDir = join(verificationWiki, namespaceRel, issueSourceRepo.replace("/", "_"));
  const issueManifest = JSON.parse(readFileSync(join(issueDir, ".wikikb-github-issues.json"), "utf8"));
  assert.equal(issueManifest.issues.length, 1);
  assert.ok(readdirSync(issueDir).some((entry) => entry.endsWith(".md")));

  const status = runOk([verificationTarget, "status"], { cache: verificationCacheDir });
  assert.match(status.stdout, /Namespace:/);
  assert.match(status.stdout, /Pages:\s+[3-9]/);

  const indexed = runOk([verificationTarget, "index"], { cache: verificationCacheDir, timeout: 300_000 });
  assert.match(indexed.stdout, new RegExp(`LexCAT ${lexcatManifest.version.replace(/\./g, "\\.")}`));

  const sharedKbName = `${kbName}-shared`;
  const sharedTarget = `${sharedKbName}.${namespaceKey}`;
  runOk(["add", sharedKbName, slug], { cache: sharedCacheVerificationDir });
  const restored = runOk([sharedTarget, "index"], { cache: sharedCacheVerificationDir, timeout: 300_000 });
  assert.match(restored.stdout, /restored from shared wiki cache/);
  const sharedSearch = runOk([sharedTarget, "search", marker, "--top", "3"], {
    cache: sharedCacheVerificationDir,
    timeout: 120_000,
  });
  assert.match(sharedSearch.stdout, new RegExp(publishedTitle));

  const search = runOk([verificationTarget, "search", marker, "--top", "10", "--tag", "integration"], { cache: verificationCacheDir });
  assert.match(search.stdout, new RegExp(publishedTitle));
  assert.match(search.stdout, new RegExp(urlTitle));

  const query = runOk([verificationTarget, "query", marker, "--no-ai", "--top", "2"], { cache: verificationCacheDir });
  assert.match(query.stdout, new RegExp(publishedTitle));

  const llmScript = join(articleDir, "fake-llm.cjs");
  writeFileSync(
    llmScript,
    'let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", c => input += c); process.stdin.on("end", () => { const r = JSON.parse(input); process.stdout.write(`Live integration ${r.task}: ${r.query}`); });\n',
  );
  const generated = runOk([verificationTarget, "summarize", marker, "--ai"], {
    cache: verificationCacheDir,
    extraEnv: {
      WIKIKB_COPILOT_TOKEN: "",
      COPILOT_GITHUB_TOKEN: "",
      WIKIKB_OPENAI_API_KEY: "",
      OPENAI_API_KEY: "",
      WIKIKB_OPENAI_BASE_URL: "",
      WIKIKB_AI_PROVIDER: "command",
      WIKIKB_AI_MODEL: "fixture-command-model",
      WIKIKB_LLM_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(llmScript)}`,
    },
  });
  assert.match(generated.stdout, new RegExp(marker));
  assert.match(generated.stdout, new RegExp(`integration-(published|url)-${runId}\\.md`, "i"));
  assert.match(generated.stdout, /Sources/);

  const lint = runOk([verificationTarget, "lint"], { cache: verificationCacheDir });
  assert.match(lint.stdout, /Pages:/);
  const explore = runOk([verificationTarget, "explore"], { cache: verificationCacheDir });
  assert.match(explore.stdout, /Exploration Report/);
  const tags = runOk([verificationTarget, "tags"], { cache: verificationCacheDir });
  assert.match(tags.stdout, /#integration/);

  rmSync(articleDir, { recursive: true, force: true });
});

test("live clients reuse one verified vendored runtime", () => {
  const installDir = `v${lexcatManifest.version}-${process.platform}-${process.arch}`;
  const artifact = lexcatManifest.artifacts.find(
    (candidate) => candidate.platform === process.platform && candidate.arch === process.arch,
  );
  const installed = [cacheDir, verificationCacheDir, sharedCacheVerificationDir]
    .map((root) => join(root, "runtime", "lexcat", installDir, artifact.executable))
    .filter((path) => existsSync(path));
  assert.ok(installed.length > 0, "the live suite never materialized the vendored runtime");
  for (const path of installed) {
    assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), artifact.executable_sha256);
  }
});

test("live sync is idempotent and keeps the cached remote credential-free", () => {
  ensureVerificationKb();
  const first = runOk([verificationTarget, "sync"], { cache: verificationCacheDir, timeout: 180_000 });
  const second = runOk([verificationTarget, "sync"], { cache: verificationCacheDir, timeout: 180_000 });
  assert.match(first.stdout, /Synced \d+ pages/);
  assert.match(second.stdout, /Synced \d+ pages/);

  const wiki = join(verificationCacheDir, verificationKbName, "wiki");
  assert.equal(gitChecked(["status", "--porcelain"], wiki), "");
  assert.equal(gitChecked(["remote", "get-url", "origin"], wiki), `https://github.com/${slug}.wiki.git`);
  assert.doesNotMatch(readFileSync(join(wiki, ".git", "config"), "utf8"), /x-access-token|github_pat_/i);
});

test("live tag filters isolate independently ingested sources", () => {
  ensureVerificationKb();
  const release = runOk([
    verificationTarget, "search", marker, "--top", "10", "--tag", "integration,release",
  ], { cache: verificationCacheDir, timeout: 120_000 });
  assert.match(release.stdout, new RegExp(publishedTitle));
  assert.doesNotMatch(release.stdout, new RegExp(urlTitle));

  const url = runOk([
    verificationTarget, "search", marker, "--top", "10", "--tag", "integration,url",
  ], { cache: verificationCacheDir, timeout: 120_000 });
  assert.match(url.stdout, new RegExp(urlTitle));
  assert.doesNotMatch(url.stdout, new RegExp(publishedTitle));
});

test("all prompt tasks use live retrieval and expose cited sources", () => {
  ensureVerificationKb();
  const fixtureDir = mkdtempSync(join(tmpdir(), "wikikb-live-prompts-"));
  const llmScript = join(fixtureDir, "task-llm.cjs");
  writeFileSync(
    llmScript,
    'let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", c => input += c); process.stdin.on("end", () => { const r = JSON.parse(input); process.stdout.write(`task=${r.task}; query=${r.query}; sources=${r.sources.length}`); });\n',
  );
  const providerEnv = {
    WIKIKB_COPILOT_TOKEN: "",
    COPILOT_GITHUB_TOKEN: "",
    WIKIKB_OPENAI_API_KEY: "",
    OPENAI_API_KEY: "",
    WIKIKB_OPENAI_BASE_URL: "",
    WIKIKB_AI_PROVIDER: "command",
    WIKIKB_AI_MODEL: "fixture-command-model",
    WIKIKB_LLM_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(llmScript)}`,
  };

  try {
    for (const task of ["query", "summarize", "rewrite", "extract", "timeline"]) {
      const generated = runOk([verificationTarget, task, marker, "--ai", "--top", "2"], {
        cache: verificationCacheDir,
        extraEnv: providerEnv,
        timeout: 120_000,
      });
      const expectedTask = task === "query" ? "answer" : task;
      assert.match(generated.stdout, new RegExp(`task=${expectedTask}; query=${marker}; sources=2`));
      assert.match(generated.stdout, /--- Sources/);
      assert.match(generated.stdout, new RegExp(`integration-(published|url)-${runId}\\.md`, "i"));
    }

    const prompt = runOk([verificationTarget, "query", marker, "--show-prompt", "--top", "2"], {
      cache: verificationCacheDir,
      extraEnv: providerEnv,
      timeout: 120_000,
    });
    assert.match(prompt.stdout, /# Prompt: answer/);
    assert.match(prompt.stdout, new RegExp(marker));
    assert.match(prompt.stdout, /^# Context$/m);
    assert.match(prompt.stdout, /^# KB entries$/m);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("live source changes invalidate, republish, and restore the shared index", () => {
  ensureVerificationKb();
  runOk([verificationTarget, "index"], { cache: verificationCacheDir, timeout: 300_000 });
  const sidecarDir = join(verificationCacheDir, verificationKbName, "index-store", "lexcat-corpus");
  const oldSidecarPath = readdirSync(sidecarDir).map((entry) => join(sidecarDir, entry)).find((path) => path.endsWith(".lexcat.json"));
  assert.ok(oldSidecarPath);
  const oldDigest = JSON.parse(readFileSync(oldSidecarPath, "utf8")).source_digest;

  const fixtureDir = mkdtempSync(join(tmpdir(), "wikikb-live-mutation-"));
  const source = join(fixtureDir, "mutation.md");
  writeFileSync(source, `# Integration Mutation ${runId}\n\nA later wiki revision contains ${mutationMarker}.\n`);
  try {
    const pushed = runOk([liveTarget, "ingest", source, "--tag", "integration,mutation"], { timeout: 180_000 });
    assert.match(pushed.stdout, /Pushed to wiki/);
    liveWriteTouched = true;
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }

  ensureVerificationKb();
  const refreshed = runOk([verificationTarget, "search", mutationMarker, "--top", "3"], {
    cache: verificationCacheDir,
    timeout: 300_000,
  });
  assert.match(refreshed.stdout, /Integration Mutation/);
  const newDigest = JSON.parse(readFileSync(oldSidecarPath, "utf8")).source_digest;
  assert.notEqual(newDigest, oldDigest);

  const restoredKbName = `${kbName}-invalidation`;
  const restoredTarget = `${restoredKbName}.${namespaceKey}`;
  runOk(["add", restoredKbName, slug], { cache: invalidationCacheDir });
  const restored = runOk([restoredTarget, "index"], { cache: invalidationCacheDir, timeout: 300_000 });
  assert.match(restored.stdout, /restored from shared wiki cache/);
  const replayed = runOk([restoredTarget, "search", mutationMarker, "--top", "3"], {
    cache: invalidationCacheDir,
    timeout: 120_000,
  });
  assert.match(replayed.stdout, /Integration Mutation/);
});

test("live shared cache is a bounded, verified, parentless snapshot", () => {
  ensureVerificationKb();
  runOk([verificationTarget, "index"], { cache: verificationCacheDir, timeout: 300_000 });

  const wiki = join(verificationCacheDir, verificationKbName, "wiki");
  const cacheRef = "refs/remotes/origin/wikikb-cache-v1";
  const commit = gitChecked(["rev-parse", cacheRef], wiki);
  assert.doesNotMatch(gitChecked(["cat-file", "-p", commit], wiki), /^parent /m);

  const files = gitChecked(["ls-tree", "-r", "--name-only", cacheRef], wiki).split("\n").filter(Boolean);
  const manifests = files.filter((path) => path.endsWith(".manifest.json"));
  const archives = new Set(files.filter((path) => path.endsWith(".tar.gz")));
  assert.ok(manifests.length > 0 && manifests.length <= 8);
  assert.equal(files.length, manifests.length * 2);
  assert.ok(files.every((path) => path.startsWith(".wikikb-cache/v1/indexes/")));
  assert.ok(files.every((path) => !path.endsWith(".md")));
  for (const path of manifests) assert.ok(archives.has(path.replace(/\.manifest\.json$/, ".tar.gz")));

  const sidecarDir = join(verificationCacheDir, verificationKbName, "index-store", "lexcat-corpus");
  const sidecarPath = readdirSync(sidecarDir).map((entry) => join(sidecarDir, entry)).find((path) => path.endsWith(".lexcat.json"));
  assert.ok(sidecarPath, "live index sidecar is missing");
  const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
  const manifestPath = `.wikikb-cache/v1/indexes/${sidecar.index_name}.manifest.json`;
  const archivePath = manifestPath.replace(/\.manifest\.json$/, ".tar.gz");
  const manifest = JSON.parse(gitChecked(["show", `${cacheRef}:${manifestPath}`], wiki));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.index_name, sidecar.index_name);
  assert.equal(manifest.source_digest, sidecar.source_digest);
  assert.equal(manifest.runtime_compatibility, "release:0.3.0");
  assert.ok(manifest.items >= 3);

  const archive = spawnSync("git", ["show", `${cacheRef}:${archivePath}`], {
    cwd: wiki,
    encoding: null,
    timeout: 120_000,
    maxBuffer: 128 * 1024 * 1024,
  });
  assert.equal(archive.status, 0, String(archive.stderr || ""));
  assert.equal(archive.stdout.length, manifest.archive_bytes);
  assert.equal(createHash("sha256").update(archive.stdout).digest("hex"), manifest.archive_sha256);

  const auditDir = mkdtempSync(join(tmpdir(), "wikikb-live-cache-audit-"));
  try {
    const localArchive = join(auditDir, "index.tar.gz");
    writeFileSync(localArchive, archive.stdout);
    const extracted = spawnSync("tar", ["-xzf", localArchive, "-C", auditDir], { encoding: "utf8" });
    assert.equal(extracted.status, 0, extracted.stderr);
    const indexDb = join(auditDir, sidecar.index_name, "index.db");
    assert.ok(existsSync(indexDb));
    assert.equal(createHash("sha256").update(readFileSync(indexDb)).digest("hex"), manifest.index_db_sha256);
  } finally {
    rmSync(auditDir, { recursive: true, force: true });
  }
});

test("vendored LexCAT indexes and queries the live integration namespace", () => {
  ensureVerificationKb();
  const result = runOk([verificationTarget, "index"], { cache: verificationCacheDir, timeout: 300_000 });
  assert.match(result.stdout, /shared cache current|restored from shared wiki cache/);
  const indexDir = join(verificationCacheDir, verificationKbName, "index-store", "lexcat-corpus");
  assert.ok(readdirSync(indexDir).some((entry) => entry.endsWith(".lexcat.json")));
  const query = runOk([verificationTarget, "search", runId, "--top", "3"], { cache: verificationCacheDir, timeout: 120_000 });
  assert.match(query.stdout, new RegExp(runId));
});

test("first retrieval installs and verifies the pinned runtime transactionally", () => {
  const runtimeKbName = `${kbName}-runtime`;
  const runtimeTarget = `${runtimeKbName}.${namespaceKey}`;
  runOk(["add", runtimeKbName, slug], { cache: runtimeBootstrapCacheDir });
  runOk([runtimeKbName, "sync"], { cache: runtimeBootstrapCacheDir, timeout: 180_000 });
  runOk([runtimeTarget, "index"], { cache: runtimeBootstrapCacheDir, timeout: 300_000 });
  const search = runOk([runtimeTarget, "search", runId, "--top", "3"], {
    cache: runtimeBootstrapCacheDir,
    timeout: 720_000,
  });
  assert.match(search.stdout, new RegExp(runId));

  const artifact = lexcatManifest.artifacts.find(
    (candidate) => candidate.platform === process.platform && candidate.arch === process.arch,
  );
  const runtimeRoot = join(runtimeBootstrapCacheDir, "runtime", "lexcat");
  const installDir = join(runtimeRoot, `v${lexcatManifest.version}-${process.platform}-${process.arch}`);
  assert.equal(
    createHash("sha256").update(readFileSync(join(installDir, artifact.executable))).digest("hex"),
    artifact.executable_sha256,
  );
  assert.ok(!readdirSync(runtimeRoot).some((entry) => entry.startsWith(".extract-")));
});

test("Copilot is explicitly selected for a live text-only generation", () => {
  ensureVerificationKb();
  const model = process.env.WIKIKB_AI_MODEL || "claude-sonnet-4.6";
  const generated = runOk([
    verificationTarget,
    "query",
    marker,
    "--provider",
    "copilot",
    "--model",
    model,
    "--top",
    "2",
  ], {
    cache: verificationCacheDir,
    timeout: 300_000,
    extraEnv: {
      WIKIKB_COPILOT_TOKEN: copilotToken,
      COPILOT_GITHUB_TOKEN: "",
      WIKIKB_AI_PROVIDER: "",
      WIKIKB_AI_MODEL: "",
    },
  });
  assert.match(generated.stdout, /--- Sources/);
  assert.match(generated.stdout, new RegExp(`integration-(published|url)-${runId}\\.md`, "i"));
});
