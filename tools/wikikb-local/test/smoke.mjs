import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const wkb = join(repoRoot, "tools/wikikb-local/wkb");
const testSlug = "owner/demo-repo";

function run(args, cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-")), env = {}) {
  const result = spawnSync(wkb, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      WIKIKB_CACHE_DIR: cacheDir,
      WIKIKB_GITHUB_TOKEN: "",
      GITHUB_TOKEN: "",
      WIKIKB_AI_PROVIDER: "",
      WIKIKB_AI_MODEL: "",
      WIKIKB_LLM_COMMAND: "",
      WIKIKB_COPILOT_TOKEN: "",
      COPILOT_GITHUB_TOKEN: "",
      WIKIKB_OPENAI_API_KEY: "",
      OPENAI_API_KEY: "",
      WIKIKB_OPENAI_BASE_URL: "",
      ...env,
    },
  });
  return { ...result, cacheDir };
}

function startRun(args, cacheDir, extraEnv = {}) {
  const child = spawn(wkb, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      WIKIKB_CACHE_DIR: cacheDir,
      WIKIKB_GITHUB_TOKEN: "",
      GITHUB_TOKEN: "",
      WIKIKB_AI_PROVIDER: "",
      WIKIKB_AI_MODEL: "",
      WIKIKB_LLM_COMMAND: "",
      WIKIKB_COPILOT_TOKEN: "",
      COPILOT_GITHUB_TOKEN: "",
      WIKIKB_OPENAI_API_KEY: "",
      OPENAI_API_KEY: "",
      WIKIKB_OPENAI_BASE_URL: "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const completed = new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (status, signal) => resolvePromise({ status, signal, stdout, stderr }));
  });
  return { child, completed };
}

test("help shows TypeScript CLI usage", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Requires the vendored LexCAT runtime/);
  assert.match(result.stdout, /WIKIKB_LEXCAT_BIN/);
  assert.ok(result.stdout.trim().split(/\r?\n/).length < 45, "help output should stay concise");
  assert.doesNotMatch(result.stdout, /WIKIKB_LLM_(?:TOKEN|MODEL|API)/);
});

test("version matches the release version", () => {
  const result = run(["--version"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "0.1.0");

  for (const args of [["--version", "extra"], ["--help", "extra"], ["version", "extra"]]) {
    const invalid = run(args);
    assert.notEqual(invalid.status, 0, `${args.join(" ")} should reject extra arguments`);
  }
});

test("skills install creates, preserves, and explicitly replaces the user skill", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  const skillsRoot = join(cacheDir, ".agents", "skills");
  const skillPath = join(skillsRoot, "wikikb-memory", "SKILL.md");
  const metadataPath = join(skillsRoot, "wikikb-memory", "agents", "openai.yaml");

  const installed = run(["skills", "install", "--path", skillsRoot], cacheDir);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /Installed:/);
  assert.match(readFileSync(skillPath, "utf8"), /^---\nname: wikikb-memory\n/);
  assert.match(readFileSync(metadataPath, "utf8"), /display_name: "WikiKB Memory"/);

  const unchanged = run(["skills", "install", "--path", skillsRoot], cacheDir);
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.match(unchanged.stdout, /Already installed:/);

  writeFileSync(skillPath, "user customization\n");
  const refused = run(["skills", "install", "--path", skillsRoot], cacheDir);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Refusing to overwrite 1 changed skill file/);
  assert.equal(readFileSync(skillPath, "utf8"), "user customization\n");

  const forced = run(["skills", "install", "--path", skillsRoot, "--force"], cacheDir);
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(readFileSync(skillPath, "utf8"), /^---\nname: wikikb-memory\n/);
});

test("retired adapter flag is rejected", () => {
  const result = run([["--native", "messaging"].join("-")]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /wkb - WikiKB command-line tool/);
});

test("add, list, and status work without network", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  const add = run(["add", "test-kb", testSlug], cacheDir);
  assert.equal(add.status, 0, add.stderr);
  assert.match(add.stdout, /Added 'test-kb'/);

  const list = run(["list"], cacheDir);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /test-kb/);
  assert.match(list.stdout, /owner\/demo-repo/);

  const status = run(["test-kb", "status"], cacheDir);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /not synced/);
  assert.match(status.stdout, /not built/);
});

test("AI provider and model configuration is explicit", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["config", "set", "ai.provider", "copilot"], cacheDir).status, 0);
  assert.equal(run(["config", "set", "ai.model", "fixture-model"], cacheDir).status, 0);

  const listed = run(["config", "list"], cacheDir);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /ai\.provider=copilot/);
  assert.match(listed.stdout, /ai\.model=fixture-model/);
  assert.equal(run(["config", "get", "ai.provider"], cacheDir).stdout.trim(), "copilot");

  const invalid = run(["config", "set", "ai.provider", "automatic"], cacheDir);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Invalid AI provider/);

  assert.equal(run(["config", "unset", "ai.provider"], cacheDir).status, 0);
  assert.equal(run(["config", "get", "ai.provider"], cacheDir).stdout.trim(), "");
});

test("dotted targets filter pages by namespace", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);

  writeWiki(cacheDir, "test-kb", "sources/foo/bar/zap/a.md", "# A\n\n**Tags:** #zap\n");
  writeWiki(cacheDir, "test-kb", "sources/foo/bar/brap/b.md", "# B\n\n**Tags:** #brap\n");
  writeWiki(cacheDir, "test-kb", "sources/foo/nope.md", "# Nope\n\n**Tags:** #nope\n");
  writeWiki(cacheDir, "test-kb", "concepts/foo.bar.zap.concept.md", "# Concept\n");
  writeWiki(cacheDir, "test-kb", "sources/meta.md", "# Meta\n\n**Namespace:** foo.bar.zap\n");

  const broad = run(["test-kb.foo.bar", "status"], cacheDir);
  assert.equal(broad.status, 0, broad.stderr);
  assert.match(broad.stdout, /Namespace:\s+foo\.bar/);
  assert.match(broad.stdout, /Pages:\s+4 total \(1 concepts, 3 sources, 0 queries\)/);

  const narrow = run(["test-kb.foo.bar.zap", "status"], cacheDir);
  assert.equal(narrow.status, 0, narrow.stderr);
  assert.match(narrow.stdout, /Namespace:\s+foo\.bar\.zap/);
  assert.match(narrow.stdout, /Pages:\s+3 total \(1 concepts, 2 sources, 0 queries\)/);
});

test("namespaces are limited to five levels", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  const result = run(["test-kb.a.b.c.d.e.f", "status"], cacheDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /supports up to 5 namespace levels/);
});

test("registered KB names cannot contain dots", () => {
  const result = run(["add", "test-kb.foo", testSlug]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Dots are reserved for namespaces/);
});

test("registered KB names reject empty, spaced, and path-like values", () => {
  for (const name of ["", "-leading", "two words", "owner/name"]) {
    const result = run(["add", name, testSlug]);
    assert.notEqual(result.status, 0, `expected '${name}' to fail`);
    assert.match(result.stderr, /KB names must start with/);
  }
});

test("registration is idempotent but refuses reserved names and repository remaps", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);

  const repeated = run(["add", "test-kb", testSlug], cacheDir);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stdout, /already registered/);

  const remap = run(["add", "test-kb", "owner/other-repo"], cacheDir);
  assert.notEqual(remap.status, 0);
  assert.match(remap.stderr, /already registered for owner\/demo-repo/);

  for (const name of ["add", "list", "prompts", "version"]) {
    const reserved = run(["add", name, testSlug], cacheDir);
    assert.notEqual(reserved.status, 0, `${name} should remain reserved`);
    assert.match(reserved.stderr, /reserved as a global command/);
  }
});

test("registry supports object-prototype names and reports corrupt JSON paths", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  for (const name of ["constructor", "toString", "hasOwnProperty"]) {
    const added = run(["add", name, testSlug], cacheDir);
    assert.equal(added.status, 0, `${name} failed: ${added.stderr}`);
    const status = run([name, "status"], cacheDir);
    assert.equal(status.status, 0, `${name} status failed: ${status.stderr}`);
  }
  const listed = run(["list"], cacheDir);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /constructor/);
  assert.match(listed.stdout, /toString/);

  const configPath = join(cacheDir, "config.json");
  writeFileSync(configPath, "{not-json\n");
  const badConfig = run(["list"], cacheDir);
  assert.notEqual(badConfig.status, 0);
  assert.match(badConfig.stderr, /Invalid WikiKB registry JSON/);
  assert.match(badConfig.stderr, /config\.json/);
});

test("all command targets validate KB names and state JSON", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  for (const target of ["../test-kb", "-leading", "two words", "owner/name"]) {
    const invalid = run([target, "status"], cacheDir);
    assert.notEqual(invalid.status, 0, `${target} should fail`);
    assert.match(invalid.stderr, /Invalid KB name|Invalid KB target|Invalid namespace/);
  }

  const statePath = join(cacheDir, "test-kb", "state.json");
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, "[]\n");
  const badState = run(["test-kb", "status"], cacheDir);
  assert.notEqual(badState.status, 0);
  assert.match(badState.stderr, /Invalid WikiKB state/);
  assert.match(badState.stderr, /state\.json/);
});

test("cache roots are private on POSIX systems", { skip: process.platform === "win32" }, () => {
  const parent = mkdtempSync(join(tmpdir(), "wikikb-cache-mode-"));
  const cacheDir = join(parent, "nested-cache");
  assert.equal(run(["list"], cacheDir).status, 0);
  assert.equal(statSync(cacheDir).mode & 0o777, 0o700);
});

test("repo slugs must use owner/repo format", () => {
  const result = run(["add", "test-kb", ""]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /owner\/repo format/);
});

test("commands reject unexpected and undocumented arguments", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  writeWiki(cacheDir, "test-kb", "Home.md", "# Home\n");
  writeState(cacheDir, "test-kb");

  for (const args of [
    ["add", "extra-kb", testSlug, "extra"],
    ["list", "extra"],
    ["test-kb", "sync", "extra"],
    ["test-kb", "status", "extra"],
    ["test-kb", "index", "--unknown"],
    ["test-kb", "query", "release", "--force"],
    ["test-kb", "lint", "extra"],
    ["test-kb", "explore", "--top", "2"],
    ["test-kb", "tags", "extra"],
    ["prompts", "list", "extra"],
    ["prompts", "init", "--unknown"],
    ["prompts", "show", "answer", "extra"],
  ]) {
    const result = run(args, cacheDir);
    assert.notEqual(result.status, 0, `${args.join(" ")} should fail`);
    assert.ok(result.stderr.trim(), `${args.join(" ")} should explain the failure`);
  }
});

test("index fails clearly when a configured LexCAT executable is unavailable", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  writeWiki(cacheDir, "test-kb", "sources/fox.md", "# Fox\n\nFoxes are cunning animals.\n");
  writeState(cacheDir, "test-kb");
  const result = run(["test-kb", "index"], cacheDir, {
    WIKIKB_LEXCAT_BIN: join(cacheDir, "missing-lexcat"),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Configured LexCAT executable does not exist/);
});

test("retrieval commands build a missing index once and reuse it", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  const commandLog = join(cacheDir, "lexcat-commands.jsonl");
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  writeWiki(cacheDir, "test-kb", "sources/fox.md", "# Fox\n\nFoxes are cunning animals.\n");
  writeWiki(cacheDir, "test-kb", "sources/climate.md", "# Climate\n\nRising sea levels affect coastal cities.\n");
  writeState(cacheDir, "test-kb");
  const env = {
    WIKIKB_LEXCAT_BIN: writeFakeLexcatCli(cacheDir),
    WIKIKB_FAKE_LEXCAT_LOG: commandLog,
  };

  for (const command of ["search", "query", "summarize", "rewrite", "extract", "timeline"]) {
    const options = command === "search" ? [] : ["--show-prompt"];
    const result = run(["test-kb", command, "cunning fox", "--top", "1", ...options], cacheDir, env);
    assert.equal(result.status, 0, `${command} failed: ${result.stderr}`);
    assert.match(result.stdout, /Fox|Relevant context/);
  }
  const commands = readFileSync(commandLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(commands.filter((args) => args.includes("build")).length, 1);
  assert.equal(commands.filter((args) => args.includes("query")).length, 6);
});

test("staged corpus filenames cannot collide when wiki paths flatten alike", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  writeWiki(cacheDir, "test-kb", "sources/a/b.md", "# Nested\n\nNested path marker.\n");
  writeWiki(cacheDir, "test-kb", "sources/a_b.md", "# Flat\n\nFlat path marker.\n");
  writeState(cacheDir, "test-kb");
  indexWithFakeLexcat(cacheDir);

  const corpusDir = join(cacheDir, "test-kb", "index-store", "lexcat-corpus", "owner_demo-repo");
  const staged = readdirSync(corpusDir).filter((entry) => entry.endsWith(".md"));
  assert.equal(staged.length, 2);
  const byWikiPath = new Map(staged.map((entry) => {
    const body = readFileSync(join(corpusDir, entry), "utf8");
    return [body.match(/^wikikb_path: "(.+)"$/m)[1], body];
  }));
  assert.match(byWikiPath.get("sources/a/b.md"), /Nested path marker/);
  assert.match(byWikiPath.get("sources/a_b.md"), /Flat path marker/);
  // LexCAT indexes every file it walks, so the build root holds documents only.
  assert.deepEqual(readdirSync(corpusDir).filter((entry) => !entry.endsWith(".md")), []);
});

test("staged corpus carries wiki identity as frontmatter LexCAT hands back on every hit", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  writeWiki(cacheDir, "test-kb", "sources/fox.md", "# Fox\n\nFoxes are cunning animals.\n");
  writeState(cacheDir, "test-kb");
  indexWithFakeLexcat(cacheDir);

  const corpusRoot = join(cacheDir, "test-kb", "index-store", "lexcat-corpus");
  const corpusDir = join(corpusRoot, "owner_demo-repo");
  const staged = readdirSync(corpusDir).filter((entry) => entry.endsWith(".md"));
  assert.equal(staged.length, 1);
  assert.equal(
    readFileSync(join(corpusDir, staged[0]), "utf8"),
    '---\ntitle: "Fox"\nwikikb_path: "sources/fox.md"\n---\n\n# Fox\n\nFoxes are cunning animals.\n',
  );
  // Identity rides the document itself now, so no side manifest is written.
  assert.deepEqual(readdirSync(corpusRoot).filter((entry) => entry.endsWith(".corpus.json")), []);
});

test("index and search use the LexCAT runtime contract", { skip: process.platform === "win32" }, () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  const lexcatBin = writeFakeLexcatCli(cacheDir);
  const commandLog = join(cacheDir, "lexcat-commands.jsonl");
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  writeWiki(cacheDir, "test-kb", "sources/fox.md", "# Fox\n\nFoxes are cunning animals.\n");
  writeWiki(cacheDir, "test-kb", "sources/climate.md", "# Climate\n\nRising sea levels affect coastal cities.\n");
  writeState(cacheDir, "test-kb");

  const env = { WIKIKB_LEXCAT_BIN: lexcatBin, WIKIKB_FAKE_LEXCAT_LOG: commandLog };
  const index = run(["test-kb", "index"], cacheDir, env);
  assert.equal(index.status, 0, index.stderr);
  assert.match(index.stdout, /LexCAT override/);
  assert.ok(existsSync(join(cacheDir, "test-kb", "index-store", "lexcat-output", "owner_demo-repo.db")));

  const search = run(["test-kb", "search", "fox", "--top", "1"], cacheDir, env);
  assert.equal(search.status, 0, search.stderr);
  assert.match(search.stdout, /Fox/);
  assert.match(search.stdout, /sources\/fox\.md/);

  const forced = run(["test-kb", "index", "--force"], cacheDir, env);
  assert.equal(forced.status, 0, forced.stderr);
  const commands = readFileSync(commandLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const builds = commands.filter((args) => args.includes("build"));
  assert.ok(builds.length >= 2);
  // `--force` is the repair path, so it rebuilds rather than reconciling.
  assert.equal(commands.filter((args) => args.includes("sync")).length, 0);
  // Every build writes to a scratch file that is swapped in once verified.
  assert.ok(builds.every((args) => args[0] === "--index" && args[1].endsWith(".db.building")));
  // Indexing reads its chunk and term counts out of the machine-readable report.
  assert.ok(builds.every((args) => args.includes("--json")));
  // Retrieval reads results out of the machine-readable query document.
  assert.ok(commands.some((args) => args.includes("query") && args.includes("--n") && args.includes("--json")));

  const unparseable = run(["test-kb", "search", "cunning fox", "--top", "1"], cacheDir, {
    ...env,
    WIKIKB_FAKE_LEXCAT_UNPARSEABLE: "1",
  });
  assert.notEqual(unparseable.status, 0);
  assert.equal(unparseable.stdout, "");
  assert.match(unparseable.stderr, /Could not parse LexCAT query output/);

  const emptyQuery = run(["test-kb", "search", "cunning fox", "--top", "1"], cacheDir, {
    ...env,
    WIKIKB_FAKE_LEXCAT_EMPTY_QUERY: "1",
  });
  assert.notEqual(emptyQuery.status, 0);
  assert.equal(emptyQuery.stdout, "");
  assert.match(emptyQuery.stderr, /LexCAT returned no chunks/);

  // A ranked hit carrying no text cannot be cited, so it is dropped rather
  // than surfaced as an empty context block.
  const unknownChunk = run(["test-kb", "search", "cunning fox", "--top", "1"], cacheDir, {
    ...env,
    WIKIKB_FAKE_LEXCAT_UNKNOWN_CHUNK: "1",
  });
  assert.notEqual(unknownChunk.status, 0);
  assert.equal(unknownChunk.stdout, "");
  assert.match(unknownChunk.stderr, /LexCAT returned no chunks/);

  const missingIndex = run(["test-kb", "index", "--force"], cacheDir, {
    ...env,
    WIKIKB_FAKE_LEXCAT_SKIP_INDEX: "1",
  });
  assert.notEqual(missingIndex.status, 0);
  assert.match(missingIndex.stderr, /completed without creating an index/);

  // An empty corpus builds and queries at exit 0 upstream, so WikiKB rejects it
  // at build time instead of letting every later search return nothing.
  const emptyIndex = run(["test-kb", "index", "--force"], cacheDir, {
    ...env,
    WIKIKB_FAKE_LEXCAT_EMPTY_INDEX: "1",
  });
  assert.notEqual(emptyIndex.status, 0);
  assert.match(emptyIndex.stderr, /indexed no chunks/);

  // Chunks can be indexed while the analyzer discards every term, which leaves a
  // populated but permanently unsearchable index -- the chunk count alone would
  // not catch it.
  const noTerms = run(["test-kb", "index", "--force"], cacheDir, {
    ...env,
    WIKIKB_FAKE_LEXCAT_NO_TERMS: "1",
  });
  assert.notEqual(noTerms.status, 0);
  assert.match(noTerms.stderr, /no terms/);

  // A failed rebuild must leave the previous index queryable.
  const afterFailure = run(["test-kb", "search", "fox", "--top", "1"], cacheDir, env);
  assert.equal(afterFailure.status, 0, afterFailure.stderr);
  assert.match(afterFailure.stdout, /Fox/);
});

test("a warm index is reconciled incrementally instead of rebuilt", { skip: process.platform === "win32" }, () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  const commandLog = join(cacheDir, "lexcat-commands.jsonl");
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  writeWiki(cacheDir, "test-kb", "sources/fox.md", "# Fox\n\nFoxes are cunning animals.\n");
  writeState(cacheDir, "test-kb");

  const env = { WIKIKB_LEXCAT_BIN: writeFakeLexcatCli(cacheDir), WIKIKB_FAKE_LEXCAT_LOG: commandLog };
  assert.equal(run(["test-kb", "index"], cacheDir, env).status, 0);
  assert.deepEqual(lexcatCommands(commandLog), ["build"]);

  writeWiki(cacheDir, "test-kb", "sources/zeppelin.md", "# Zeppelin\n\nAirships once crossed the Atlantic.\n");
  writeState(cacheDir, "test-kb");
  const reindexed = run(["test-kb", "index"], cacheDir, env);
  assert.equal(reindexed.status, 0, reindexed.stderr);
  assert.match(reindexed.stdout, /incremental/);
  assert.deepEqual(lexcatCommands(commandLog), ["build", "sync"]);
  // The reconcile path reports its counts machine-readably too.
  const syncArgs = readFileSync(commandLog, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((args) => args.includes("sync"));
  assert.ok(syncArgs.includes("--json"));

  const search = run(["test-kb", "search", "airships", "--top", "1"], cacheDir, env);
  assert.equal(search.status, 0, search.stderr);
  assert.match(search.stdout, /Zeppelin/);
  assert.match(search.stdout, /sources\/zeppelin\.md/);
});

const vendoredLexcatManifest = JSON.parse(readFileSync(join(repoRoot, "vendor", "lexcat", "manifest.json"), "utf8"));
const vendoredLexcatArtifact = vendoredLexcatManifest.artifacts.find(
  (candidate) => candidate.platform === process.platform && candidate.arch === process.arch,
);

// The `wkb` launcher is a bash script with no Windows shim, so a Windows host
// cannot spawn it directly. The Windows CI job exercises the vendored runtime
// against the LexCAT CLI itself instead of through the launcher.
const canDriveWkbLauncher = process.platform !== "win32";

test("vendored LexCAT indexes a staged wiki corpus and returns chunk text", {
  skip: !vendoredLexcatArtifact || !canDriveWkbLauncher,
}, () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-lexcat-real-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  writeWiki(cacheDir, "test-kb", "sources/fox.md", "# Fox Retrieval\n\nFoxes cache acorns beside the cedar observatory.\n");
  writeWiki(cacheDir, "test-kb", "sources/climate.md", "# Climate\n\nRising sea levels affect coastal cities.\n");
  writeState(cacheDir, "test-kb");

  const index = run(["test-kb", "index", "--force"], cacheDir);
  assert.equal(index.status, 0, index.stderr);
  assert.match(index.stdout, new RegExp(`LexCAT ${vendoredLexcatManifest.version.replace(/\./g, "\\.")}`));

  const sidecar = JSON.parse(readFileSync(join(cacheDir, "test-kb", "index-store", "lexcat-corpus", "owner_demo-repo.lexcat.json"), "utf8"));
  assert.equal(sidecar.runtime, "lexcat-cli");
  assert.equal(sidecar.lexcat_version, vendoredLexcatManifest.version);
  assert.match(sidecar.binary_sha256, /^[a-f0-9]{64}$/);

  const runtimeBin = join(
    cacheDir,
    "runtime",
    "lexcat",
    `v${vendoredLexcatManifest.version}-${process.platform}-${process.arch}`,
    vendoredLexcatArtifact.executable,
  );
  assert.equal(createHash("sha256").update(readFileSync(runtimeBin)).digest("hex"), vendoredLexcatArtifact.executable_sha256);
  writeFileSync(runtimeBin, "tampered");
  chmodSync(runtimeBin, 0o755);
  const repaired = run(["test-kb", "index", "--force"], cacheDir);
  assert.equal(repaired.status, 0, repaired.stderr);
  assert.equal(createHash("sha256").update(readFileSync(runtimeBin)).digest("hex"), vendoredLexcatArtifact.executable_sha256);

  // Text, title and wiki path all come back inside `query --json`, so this
  // exercises the real payload round-trip rather than a rejoin against disk.
  const search = run(["test-kb", "search", "cedar observatory", "--top", "2"], cacheDir);
  assert.equal(search.status, 0, search.stderr);
  assert.match(search.stdout, /Fox Retrieval/);
  assert.match(search.stdout, /sources\/fox\.md/);
  assert.match(search.stdout, /cedar observatory/);
});

test("concurrent retrieval shares one verified vendored runtime", {
  skip: !vendoredLexcatArtifact || !canDriveWkbLauncher,
}, async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-lexcat-lock-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  writeWiki(cacheDir, "test-kb", "sources/concurrency.md", "# Concurrency\n\nThe cardinal semaphore marks a shared runtime cache.\n");
  writeState(cacheDir, "test-kb");
  const indexed = run(["test-kb", "index", "--force"], cacheDir);
  assert.equal(indexed.status, 0, indexed.stderr);

  // Force both queries to extract the runtime from scratch at the same time.
  const runtimeRoot = join(cacheDir, "runtime", "lexcat");
  rmSync(runtimeRoot, { recursive: true, force: true });

  // Four racers rather than two: the publish step is a rename, and a two-process
  // race only lands in the vulnerable window intermittently.
  const racers = Array.from({ length: 4 }, () =>
    startRun(["test-kb", "search", "cardinal semaphore", "--top", "1"], cacheDir));

  let timeoutHandle;
  const timeout = new Promise((_, rejectPromise) => {
    timeoutHandle = setTimeout(() => rejectPromise(new Error("concurrent runtime-cache queries timed out")), 60_000);
  });
  let results;
  try {
    results = await Promise.race([Promise.all(racers.map((racer) => racer.completed)), timeout]);
  } finally {
    clearTimeout(timeoutHandle);
  }
  for (const result of results) {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Concurrency/);
  }
  const installDir = join(runtimeRoot, `v${vendoredLexcatManifest.version}-${process.platform}-${process.arch}`);
  assert.equal(
    createHash("sha256").update(readFileSync(join(installDir, vendoredLexcatArtifact.executable))).digest("hex"),
    vendoredLexcatArtifact.executable_sha256,
  );
  // Publishing is atomic, so no partial scratch directories may survive.
  assert.deepEqual(
    readdirSync(runtimeRoot).filter((entry) => entry.startsWith(".extract-") || entry.startsWith(".stale-")),
    [],
  );
});

test("search validates options and filters by all requested tags", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  writeWiki(cacheDir, "test-kb", "sources/alpha.md", "# Alpha\n\n**Tags:** #release #shared\n\nUnique release evidence.\n");
  writeWiki(cacheDir, "test-kb", "sources/beta.md", "# Beta\n\n**Tags:** #draft #shared\n\nUnique draft evidence.\n");
  writeState(cacheDir, "test-kb");
  const commandLog = join(cacheDir, "tag-scoped-lexcat-commands.jsonl");
  const lexcatEnv = { ...indexWithFakeLexcat(cacheDir), WIKIKB_FAKE_LEXCAT_LOG: commandLog };

  const filtered = run(["test-kb", "search", "unique evidence", "--tag", "shared,release"], cacheDir, lexcatEnv);
  assert.equal(filtered.status, 0, filtered.stderr);
  assert.match(filtered.stdout, /Alpha/);
  assert.doesNotMatch(filtered.stdout, /Beta/);

  const indexRoot = join(cacheDir, "test-kb", "index-store", "lexcat-output");
  const scopedIndexes = readdirSync(indexRoot).filter((entry) => entry.includes("__tags_") && entry.endsWith(".db"));
  assert.equal(scopedIndexes.length, 1);
  const corpusRoot = join(cacheDir, "test-kb", "index-store", "lexcat-corpus");
  const scopedCorpus = readdirSync(corpusRoot).find((entry) => entry.includes("__tags_"));
  const scopedDocs = readdirSync(join(corpusRoot, scopedCorpus))
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => readFileSync(join(corpusRoot, scopedCorpus, entry), "utf8").match(/^wikikb_path: "(.+)"$/m)[1]);
  assert.deepEqual(scopedDocs, ["sources/alpha.md"]);
  assert.match(filtered.stderr, /Searching scoped index for tags #release, #shared \(1 pages indexed\)/);

  const repeated = run(["test-kb", "search", "unique evidence", "--tag", "release,shared"], cacheDir, lexcatEnv);
  assert.equal(repeated.status, 0, repeated.stderr);
  const scopedCommands = readFileSync(commandLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(scopedCommands.filter((args) => args.includes("build")).length, 1);
  assert.equal(scopedCommands.filter((args) => args.includes("query")).length, 2);

  for (const args of [
    ["test-kb", "search", "evidence", "--top", "0"],
    ["test-kb", "search", "evidence", "--top", "many"],
    ["test-kb", "search", "evidence", "--tag"],
    ["test-kb", "search", "evidence", "--ai"],
    ["test-kb", "search", "evidence", "--show-prompt"],
    ["test-kb", "search", "evidence", "--top", "1", "--top", "2"],
    ["test-kb", "search", "evidence", "--unknown"],
  ]) {
    const result = run(args, cacheDir);
    assert.notEqual(result.status, 0, `${args.join(" ")} should fail`);
    assert.match(result.stderr, /ERROR:/);
  }
});

test("tags, lint, and explore report local wiki health", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  writeWiki(cacheDir, "test-kb", "Home.md", "# Home\n\n[[concepts/linked]]\n");
  writeWiki(cacheDir, "test-kb", "concepts/linked.md", "# Linked\n\n**Tags:** #release\n");
  writeWiki(cacheDir, "test-kb", "sources/orphan.md", "# Orphan\n\n**Tags:** #release #draft\n\n[[concepts/missing]]\n");
  writeState(cacheDir, "test-kb");

  const tags = run(["test-kb", "tags"], cacheDir);
  assert.equal(tags.status, 0, tags.stderr);
  assert.match(tags.stdout, /#release\s+2 pages/);
  assert.match(tags.stdout, /#draft\s+1 page/);

  const lint = run(["test-kb", "lint"], cacheDir);
  assert.equal(lint.status, 0, lint.stderr);
  assert.match(lint.stdout, /Broken links \(1\)/);
  assert.match(lint.stdout, /sources\/orphan\.md -> \[\[concepts\/missing\]\]/);
  assert.match(lint.stdout, /Orphan pages \(1\)/);
  assert.match(lint.stdout, /Thin pages/);

  const explore = run(["test-kb", "explore"], cacheDir);
  assert.equal(explore.status, 0, explore.stderr);
  assert.match(explore.stdout, /Exploration Report/);
  assert.match(explore.stdout, /Pages reviewed: 3 total/);
  assert.match(explore.stdout, /sources\/orphan\.md links to/);
});

test("search is retrieval-only while query requires configured generation", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  writeWiki(cacheDir, "test-kb", "sources/fox.md", "# Fox\n\nFoxes are cunning animals used in this release example.\n");
  writeState(cacheDir, "test-kb");
  const lexcatEnv = indexWithFakeLexcat(cacheDir);

  const retrievalOnly = run(["test-kb", "search", "cunning fox"], cacheDir, lexcatEnv);
  assert.equal(retrievalOnly.status, 0, retrievalOnly.stderr);
  assert.match(retrievalOnly.stdout, /Fox/);

  const queryWithoutGeneration = run(["test-kb", "query", "cunning fox", "--no-ai"], cacheDir, lexcatEnv);
  assert.equal(queryWithoutGeneration.status, 0, queryWithoutGeneration.stderr);
  assert.match(queryWithoutGeneration.stdout, /Fox/);
  assert.match(queryWithoutGeneration.stdout, /sources\/fox\.md/);

  const unconfigured = run(["test-kb", "query", "cunning fox"], cacheDir, lexcatEnv);
  assert.notEqual(unconfigured.status, 0);
  assert.match(unconfigured.stderr, /AI provider is not configured/);
  assert.match(unconfigured.stderr, /search.*retrieval only/);

  const prompt = run(["test-kb", "summarize", "cunning fox", "--show-prompt"], cacheDir, lexcatEnv);
  assert.equal(prompt.status, 0, prompt.stderr);
  assert.match(prompt.stdout, /# Direct response contract/);
  assert.match(prompt.stdout, /Never open with a preface/);
  assert.match(prompt.stdout, /silently inspect the first paragraph/);
  assert.match(prompt.stdout, /# Prompt: summarize/);
  assert.match(prompt.stdout, /## Entry 1: Fox/);
  assert.match(prompt.stdout, /sources\/fox\.md/);

  for (const task of ["rewrite", "extract", "timeline"]) {
    const taskPrompt = run(["test-kb", task, "cunning fox", "--show-prompt"], cacheDir, lexcatEnv);
    assert.equal(taskPrompt.status, 0, `${task} failed: ${taskPrompt.stderr}`);
    assert.match(taskPrompt.stdout, new RegExp(`# Prompt: ${task}`));
  }

  for (const args of [
    ["test-kb", "query"],
    ["test-kb", "summarize"],
    ["test-kb", "summarize", "fox", "--no-ai"],
    ["test-kb", "query", "fox", "--no-ai", "--show-prompt"],
    ["test-kb", "query", "fox", "--ai", "--no-ai"],
    ["test-kb", "query", "fox", "--tag", "one", "--tag", "two"],
  ]) {
    const invalid = run(args, cacheDir);
    assert.notEqual(invalid.status, 0, `${args.join(" ")} should fail`);
    assert.match(invalid.stderr, /Usage:|Unknown option|only once|cannot be combined|supported by query|mutually exclusive/);
  }

  const llmScript = join(cacheDir, "fake-llm.cjs");
  writeFileSync(
    llmScript,
    'let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => { const request = JSON.parse(input); process.stdout.write(`Generated ${request.task}: ${request.query}`); });\n',
  );
  const generated = run(["test-kb", "query", "cunning fox", "--ai"], cacheDir, {
    ...lexcatEnv,
    WIKIKB_AI_PROVIDER: "command",
    WIKIKB_AI_MODEL: "fixture-command-model",
    WIKIKB_LLM_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(llmScript)}`,
  });
  assert.equal(generated.status, 0, generated.stderr);
  assert.match(generated.stdout, /Generated answer: cunning fox/);
  assert.match(generated.stdout, /Sources \(1 entries\)/);

  const rewriteState = join(cacheDir, "rewrite-state");
  const rewriteScript = join(cacheDir, "fake-rewrite-llm.cjs");
  writeFileSync(
    rewriteScript,
    `const fs = require("node:fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  if (!fs.existsSync(${JSON.stringify(rewriteState)})) {
    fs.writeFileSync(${JSON.stringify(rewriteState)}, "rewritten");
    process.stdout.write(JSON.stringify({ query: "cunning fox", directive: "Emphasize verified traits." }));
    return;
  }
  process.stdout.write(\`Rewritten answer: \${request.query}; \${request.directive}\`);
});
`,
  );
  const rewritten = run(["test-kb", "query", "fox", "--rewrite-query"], cacheDir, {
    ...lexcatEnv,
    WIKIKB_AI_PROVIDER: "command",
    WIKIKB_AI_MODEL: "fixture-command-model",
    WIKIKB_LLM_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(rewriteScript)}`,
  });
  assert.equal(rewritten.status, 0, rewritten.stderr);
  assert.match(rewritten.stdout, /Rewritten answer: cunning fox; Emphasize verified traits/);

  const diagnosticOnly = run(["test-kb", "query", "fox", "--show-prompt", "--rewrite-query"], cacheDir, {
    ...lexcatEnv,
    WIKIKB_AI_PROVIDER: "command",
    WIKIKB_AI_MODEL: "fixture-command-model",
    WIKIKB_LLM_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(rewriteScript)}`,
  });
  assert.notEqual(diagnosticOnly.status, 0);
  assert.match(diagnosticOnly.stderr, /cannot be combined/);
});

test("provider and model selection are explicit and independent from credentials", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  writeWiki(cacheDir, "test-kb", "sources/release.md", "# Provider Release\n\nProvider integration evidence is grounded here.\n");
  writeState(cacheDir, "test-kb");
  const lexcatEnv = indexWithFakeLexcat(cacheDir);

  const fixtureDir = mkdtempSync(join(tmpdir(), "wikikb-provider-api-"));
  const serverScript = join(fixtureDir, "server.cjs");
  const portFile = join(fixtureDir, "port");
  const requestLog = join(fixtureDir, "requests.jsonl");
  const ghBin = join(fixtureDir, "bin");
  mkdirSync(ghBin);
  const gh = join(ghBin, "gh");
  writeFileSync(gh, '#!/bin/sh\n[ "$1" = "auth" ] && [ "$2" = "token" ] || exit 1\nprintf "%s\\n" "gh-cli-fixture-token"\n');
  chmodSync(gh, 0o755);
  writeFileSync(
    serverScript,
    `const fs = require("node:fs");
const http = require("node:http");
const server = http.createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", chunk => body += chunk);
  request.on("end", () => {
    const payload = JSON.parse(body);
    fs.appendFileSync(process.argv[3], JSON.stringify({ path: request.url, authorization: request.headers.authorization, body: payload }) + "\\n");
    response.setHeader("content-type", "application/json");
    if (request.url === "/openai/chat/completions") {
      if (payload.model === "fixture-tool-call-model") {
        response.end(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { content: "", tool_calls: [{ type: "function" }] } }] }));
        return;
      }
      if (payload.model === "fixture-empty-model") {
        response.end(JSON.stringify({ choices: [{ message: { content: "  " } }] }));
        return;
      }
      response.end(JSON.stringify({ choices: [{ message: { content: "OpenAI fixture answer" } }] }));
      return;
    }
    if (request.url === "/copilot/chat/completions") {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: "model is not accessible via the /chat/completions endpoint" }));
      return;
    }
    if (request.url === "/copilot/responses") {
      response.end(JSON.stringify({ output_text: "Copilot responses fixture answer" }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(process.argv[2], String(server.address().port)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
  );
  const server = spawn(process.execPath, [serverScript, portFile, requestLog], { stdio: "ignore" });
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(portFile) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    assert.ok(existsSync(portFile), "provider API fixture did not start");
    const baseUrl = `http://127.0.0.1:${readFileSync(portFile, "utf8").trim()}`;

    for (const malformedToken of ["...", "Bearer github_pat_invalid", "Authorization: token"]) {
      const malformed = run(["test-kb", "query", "provider integration", "--provider", "copilot", "--model", "fixture-copilot-model"], cacheDir, {
        ...lexcatEnv,
        WIKIKB_COPILOT_API_URL: `${baseUrl}/copilot`,
        WIKIKB_COPILOT_TOKEN: malformedToken,
      });
      assert.notEqual(malformed.status, 0);
      assert.match(malformed.stderr, /not a raw token value/);
    }

    const toolCall = run(["test-kb", "query", "provider integration", "--provider", "openai", "--model", "fixture-tool-call-model"], cacheDir, {
      ...lexcatEnv,
      WIKIKB_OPENAI_BASE_URL: `${baseUrl}/openai`,
      WIKIKB_OPENAI_API_KEY: "openai-fixture-key",
    });
    assert.notEqual(toolCall.status, 0);
    assert.match(toolCall.stderr, /attempted a tool call in a text-only request/);

    const empty = run(["test-kb", "query", "provider integration", "--provider", "openai", "--model", "fixture-empty-model"], cacheDir, {
      ...lexcatEnv,
      WIKIKB_OPENAI_BASE_URL: `${baseUrl}/openai`,
      WIKIKB_OPENAI_API_KEY: "openai-fixture-key",
    });
    assert.notEqual(empty.status, 0);
    assert.match(empty.stderr, /empty content/);

    const openai = run(["test-kb", "query", "provider integration", "--provider", "openai", "--model", "fixture-openai-model"], cacheDir, {
      ...lexcatEnv,
      WIKIKB_OPENAI_BASE_URL: `${baseUrl}/openai`,
      WIKIKB_OPENAI_API_KEY: "openai-fixture-key",
    });
    assert.equal(openai.status, 0, openai.stderr);
    assert.match(openai.stdout, /OpenAI fixture answer/);

    const copilot = run(["test-kb", "summarize", "provider integration"], cacheDir, {
      ...lexcatEnv,
      WIKIKB_AI_PROVIDER: "copilot",
      WIKIKB_AI_MODEL: "fixture-copilot-model",
      WIKIKB_COPILOT_API_URL: `${baseUrl}/copilot`,
      WIKIKB_COPILOT_TOKEN: "copilot-fixture-token",
      WIKIKB_COPILOT_API: "auto",
    });
    assert.equal(copilot.status, 0, copilot.stderr);
    assert.match(copilot.stdout, /Copilot responses fixture answer/);

    const commandScript = join(fixtureDir, "provider-command.cjs");
    writeFileSync(commandScript, 'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("Command provider answer"));\n');
    const selected = run(["test-kb", "query", "provider precedence", "--provider", "command", "--model", "fixture-command-model"], cacheDir, {
      ...lexcatEnv,
      WIKIKB_COPILOT_API_URL: `${baseUrl}/copilot`,
      WIKIKB_COPILOT_TOKEN: "preferred-copilot-token",
      WIKIKB_COPILOT_API: "responses",
      WIKIKB_LLM_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(commandScript)}`,
      WIKIKB_OPENAI_BASE_URL: `${baseUrl}/openai`,
      WIKIKB_OPENAI_API_KEY: "unused-openai-key",
    });
    assert.equal(selected.status, 0, selected.stderr);
    assert.match(selected.stdout, /Command provider answer/);
    assert.doesNotMatch(selected.stdout, /Copilot responses fixture answer/);

    const ghCliFallback = run(["test-kb", "query", "provider integration", "--provider", "copilot", "--model", "fixture-copilot-model"], cacheDir, {
      ...lexcatEnv,
      GITHUB_TOKEN: "git-only-token",
      PATH: `${ghBin}:${process.env.PATH}`,
      WIKIKB_COPILOT_API_URL: `${baseUrl}/copilot`,
      WIKIKB_COPILOT_API: "auto",
    });
    assert.equal(ghCliFallback.status, 0, ghCliFallback.stderr);
    assert.match(ghCliFallback.stdout, /Copilot responses fixture answer/);

    const requests = readFileSync(requestLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(requests.map((request) => request.path), [
      "/openai/chat/completions",
      "/openai/chat/completions",
      "/openai/chat/completions",
      "/copilot/chat/completions",
      "/copilot/responses",
      "/copilot/chat/completions",
      "/copilot/responses",
    ]);
    assert.equal(requests[2].authorization, "Bearer openai-fixture-key");
    assert.equal(requests[2].body.model, "fixture-openai-model");
    assert.equal(requests[3].authorization, "Bearer copilot-fixture-token");
    assert.equal(requests[4].body.model, "fixture-copilot-model");
    assert.equal(requests[5].authorization, "Bearer gh-cli-fixture-token");
    assert.equal(requests[6].authorization, "Bearer gh-cli-fixture-token");
    for (const request of requests) {
      assert.equal(Object.hasOwn(request.body, "tools"), false, "AI requests must not expose tools");
      assert.equal(Object.hasOwn(request.body, "tool_choice"), false, "AI requests must not allow tool selection");
      const serialized = JSON.stringify(request.body);
      assert.match(serialized, /untrusted data/);
      assert.match(serialized, /Return text only/);
    }
  } finally {
    server.kill("SIGTERM");
  }
});

test("prompt commands initialize, preserve, overwrite, and show templates", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  const promptsDir = join(cacheDir, "custom-prompts");
  const env = { WIKIKB_PROMPTS_DIR: promptsDir };

  const init = run(["prompts", "init"], cacheDir, env);
  assert.equal(init.status, 0, init.stderr);
  const answerPath = join(promptsDir, "answer.prompt");
  assert.ok(existsSync(answerPath));

  writeFileSync(answerPath, "custom answer\n");
  assert.equal(run(["prompts", "init"], cacheDir, env).status, 0);
  assert.equal(readFileSync(answerPath, "utf8"), "custom answer\n");

  assert.equal(run(["prompts", "init", "--force"], cacheDir, env).status, 0);
  assert.notEqual(readFileSync(answerPath, "utf8"), "custom answer\n");

  const show = run(["prompts", "show", "answer"], cacheDir, env);
  assert.equal(show.status, 0, show.stderr);
  assert.match(show.stdout, /# answer/);
  assert.match(show.stdout, /Context/);

  const unknown = run(["prompts", "unknown"], cacheDir, env);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown prompts command/);

  const traversal = run(["prompts", "show", "../answer"], cacheDir, env);
  assert.notEqual(traversal.status, 0);
  assert.match(traversal.stderr, /Invalid prompt name/);
});

test("local ingest writes namespaced source pages without pushing", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  writeWiki(cacheDir, "test-kb", "Home.md", "# Home\n");
  writeState(cacheDir, "test-kb");
  const source = join(cacheDir, "release-note.md");
  writeFileSync(source, "# Release Notes\n\nThe release is ready for a local ingest test.\n");

  const ingest = run(["test-kb.decisions", "ingest", source, "--no-push", "--tag", "release,decision"], cacheDir);
  assert.equal(ingest.status, 0, ingest.stderr);
  assert.match(ingest.stdout, /sources\/decisions\/release-notes\.md/);
  const page = readFileSync(join(cacheDir, "test-kb", "wiki", "sources", "decisions", "release-notes.md"), "utf8");
  assert.match(page, /\*\*Namespace:\*\* decisions/);
  assert.match(page, /\*\*Tags:\*\* #decision #ingested #release/);
  assert.match(page, /\*\*Original:\*\* file:release-note\.md/);
  assert.doesNotMatch(page, new RegExp(cacheDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(page, /## Full Text[\s\S]*The release is ready/);
  assert.equal((page.match(/^## Full Text$/gm) || []).length, 1);
  assert.match(page, /## Source Excerpt/);
  assert.doesNotMatch(page, /## Summary|## Key Concepts/);

  const titled = run(["test-kb.decisions", "ingest", source, "--no-push", "--title", "Explicit Release Name"], cacheDir);
  assert.equal(titled.status, 0, titled.stderr);
  assert.match(titled.stdout, /explicit-release-name\.md/);

  const badOption = run(["test-kb", "ingest", source, "--wat"], cacheDir);
  assert.notEqual(badOption.status, 0);
  assert.match(badOption.stderr, /Unknown ingest option/);

  for (const args of [
    ["test-kb", "ingest", source, "--tag", "one", "--tag", "two"],
    ["test-kb", "ingest", source, "--title", "one", "--title", "two"],
    ["test-kb", "ingest", source, "--push", "--no-push"],
  ]) {
    const duplicate = run(args, cacheDir);
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /only once/);
  }
});

test("URL ingestion bounds responses and redacts durable source references", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  writeWiki(cacheDir, "test-kb", "Home.md", "# Home\n");
  writeState(cacheDir, "test-kb");

  const fixtureDir = mkdtempSync(join(tmpdir(), "wikikb-http-fixture-"));
  const serverScript = join(fixtureDir, "server.cjs");
  const portFile = join(fixtureDir, "port");
  writeFileSync(
    serverScript,
    `const fs = require("node:fs");
const http = require("node:http");
const server = http.createServer((request, response) => {
  if (request.url.startsWith("/large")) {
    response.writeHead(200, { "content-type": "text/plain", "content-length": "100" });
    response.end("x".repeat(100));
    return;
  }
  if (request.url.startsWith("/slow")) {
    setTimeout(() => { response.writeHead(200, { "content-type": "text/plain" }); response.end("# Slow"); }, 250);
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end("<html><head><title>URL Release &amp; Notes</title><style>hidden{}</style></head><body><h1>Visible heading</h1><p>Bounded local fixture content.</p><script>doNotIngest()</script></body></html>");
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(process.argv[2], String(server.address().port)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
  );
  const server = spawn(process.execPath, [serverScript, portFile], { stdio: "ignore" });
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(portFile) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    assert.ok(existsSync(portFile), "HTTP fixture did not start");
    const port = readFileSync(portFile, "utf8").trim();

    const source = `http://127.0.0.1:${port}/article?access_token=release-test-secret&keep=yes#private-fragment`;
    const privateUrlEnv = { WIKIKB_ALLOW_PRIVATE_URLS: "1" };
    const ingested = run(["test-kb", "ingest", source, "--no-push"], cacheDir, privateUrlEnv);
    assert.equal(ingested.status, 0, ingested.stderr);
    const page = readFileSync(join(cacheDir, "test-kb", "wiki", "sources", "url-release-notes.md"), "utf8");
    assert.doesNotMatch(page, /release-test-secret|private-fragment/);
    assert.match(page, /access_token=%3Credacted%3E/);
    assert.match(page, /keep=yes/);
    assert.match(page, /^# URL Release & Notes/m);
    assert.match(page, /Visible heading\n\nBounded local fixture content/);
    assert.doesNotMatch(page, /hidden|doNotIngest/);

    const colliding = run(["test-kb", "ingest", `http://127.0.0.1:${port}/other`, "--no-push"], cacheDir, privateUrlEnv);
    assert.equal(colliding.status, 0, colliding.stderr);
    assert.match(colliding.stdout, /sources\/url-release-notes-[a-f0-9]{10}\.md/);

    const blockedPrivate = run(["test-kb", "ingest", `http://127.0.0.1:${port}/article`, "--no-push"], cacheDir);
    assert.notEqual(blockedPrivate.status, 0);
    assert.match(blockedPrivate.stderr, /must use HTTPS|private or non-public/);

    const blockedHttpsPrivate = run(["test-kb", "ingest", "https://127.0.0.1/private", "--no-push"], cacheDir);
    assert.notEqual(blockedHttpsPrivate.status, 0);
    assert.match(blockedHttpsPrivate.stderr, /private or non-public/);

    const tooLarge = run(["test-kb", "ingest", `http://127.0.0.1:${port}/large`, "--no-push"], cacheDir, {
      ...privateUrlEnv,
      WIKIKB_MAX_SOURCE_BYTES: "32",
    });
    assert.notEqual(tooLarge.status, 0);
    assert.match(tooLarge.stderr, /source exceeds 32 bytes/);

    const tooSlow = run(["test-kb", "ingest", `http://127.0.0.1:${port}/slow`, "--no-push"], cacheDir, {
      ...privateUrlEnv,
      WIKIKB_FETCH_TIMEOUT_MS: "20",
    });
    assert.notEqual(tooSlow.status, 0);
    assert.match(tooSlow.stderr, /timed out after 20 ms/);
  } finally {
    server.kill("SIGTERM");
  }
});

test("GitHub issue ingestion rejects invalid options before network access", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);

  for (const args of [
    ["test-kb", "ingest-issues", "--state", "pending"],
    ["test-kb", "ingest-issues", "--limit", "0"],
    ["test-kb", "ingest-issues", "--limit", "many"],
    ["test-kb", "ingest-issues", "--repo"],
    ["test-kb", "ingest-issues", "--label", ","],
    ["test-kb", "ingest-issues", "--namespace", "--all"],
    ["test-kb", "ingest-issues", "owner/one", "owner/two"],
    ["test-kb", "ingest-issues", "--limit", "1", "--all"],
    ["test-kb", "ingest-issues", "--state", "open", "--state", "all"],
    ["test-kb", "ingest-issues", "--comments", "--comments"],
    ["test-kb", "ingest-issues", "--namespace", "one", "--namespace", "two"],
    ["test-kb", "ingest-issues", "--push", "--no-push"],
    ["test-kb", "ingest-issues", "--unknown"],
  ]) {
    const result = run(args, cacheDir);
    assert.notEqual(result.status, 0, `${args.join(" ")} should fail`);
    assert.match(result.stderr, /ERROR:/);
  }
});

test("GitHub issue ingestion renders comments, refreshes manifests, and preserves sync state", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  writeWiki(cacheDir, "test-kb", "Home.md", "# Home\n");
  const lastSync = new Date().toISOString();
  const statePath = join(cacheDir, "test-kb", "state.json");
  writeFileSync(statePath, JSON.stringify({ last_sync: lastSync }));

  const fixtureDir = mkdtempSync(join(tmpdir(), "wikikb-issues-api-"));
  const serverScript = join(fixtureDir, "server.cjs");
  const portFile = join(fixtureDir, "port");
  const requestLog = join(fixtureDir, "requests.jsonl");
  writeFileSync(
    serverScript,
    `const fs = require("node:fs");
const http = require("node:http");
let cycle = 0;
const issue = (number, title) => ({
  number, title, state: "open", body: "Deterministic issue body for deep integration coverage.",
  html_url: \`https://example.test/source/project/issues/\${number}\`,
  created_at: "2026-07-20T00:00:00Z", updated_at: "2026-07-21T00:00:00Z",
  labels: [{ name: "release" }, { name: "bug" }], user: { login: "fixture-user" }
});
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://fixture");
  fs.appendFileSync(process.argv[3], JSON.stringify({ url: request.url, authorization: request.headers.authorization || "" }) + "\\n");
  response.writeHead(200, { "content-type": "application/json" });
  if (/\\/issues\\/\\d+\\/comments$/.test(url.pathname)) {
    response.end(url.searchParams.get("page") === "1" ? JSON.stringify([{
      body: "A release comment with useful context.", created_at: "2026-07-22T00:00:00Z",
      updated_at: "2026-07-22T00:00:00Z", user: { login: "commenter" }
    }]) : "[]");
    return;
  }
  if (url.pathname.endsWith("/issues") && url.searchParams.get("page") === "1") {
    cycle += 1;
    const selected = cycle === 1 ? issue(7, "Release fixture issue") : issue(9, "Replacement fixture issue");
    response.end(JSON.stringify([selected, { ...issue(8, "Ignored pull request"), pull_request: {} }]));
    return;
  }
  response.end("[]");
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(process.argv[2], String(server.address().port)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
  );
  const server = spawn(process.execPath, [serverScript, portFile, requestLog], { stdio: "ignore" });
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(portFile) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    assert.ok(existsSync(portFile), "GitHub API fixture did not start");
    const apiUrl = `http://127.0.0.1:${readFileSync(portFile, "utf8").trim()}`;
    const apiEnv = { WIKIKB_GITHUB_API_URL: apiUrl, WIKIKB_GITHUB_TOKEN: "fixture-token" };
    const ingestArgs = [
      "test-kb", "ingest-issues", "source/project", "--state", "all", "--all", "--comments",
      "--label", "release,bug", "--namespace", "integration.issues", "--no-push",
    ];

    const first = run(ingestArgs, cacheDir, apiEnv);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Ingested 1 GitHub issue page/);
    assert.match(first.stdout, /Left uncommitted/);
    const issueDir = join(cacheDir, "test-kb", "wiki", "sources", "integration", "issues", "source_project");
    const firstPage = join(issueDir, "release-fixture-issue-issue-7.md");
    assert.ok(existsSync(firstPage));
    assert.match(readFileSync(firstPage, "utf8"), /Comment 1 by commenter[\s\S]*release comment/);
    const manifestPath = join(issueDir, ".wikikb-github-issues.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.deepEqual(manifest.labels, ["release", "bug"]);
    assert.deepEqual(manifest.issues, [7]);
    assert.equal(JSON.parse(readFileSync(statePath, "utf8")).last_sync, lastSync);

    const second = run(ingestArgs, cacheDir, apiEnv);
    assert.equal(second.status, 0, second.stderr);
    assert.ok(!existsSync(firstPage), "stale issue page should be removed during a full refresh");
    assert.ok(existsSync(join(issueDir, "replacement-fixture-issue-issue-9.md")));

    const requests = readFileSync(requestLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(requests.some((request) => request.url.includes("state=all") && request.url.includes("labels=release%2Cbug")));
    assert.ok(requests.some((request) => request.url.includes("/issues/7/comments")));
    assert.ok(requests.every((request) => request.authorization === "Bearer fixture-token"));
  } finally {
    server.kill("SIGTERM");
  }
});

function writeWiki(cacheDir, kb, path, body) {
  const full = join(cacheDir, kb, "wiki", path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function writeState(cacheDir, kb) {
  const full = join(cacheDir, kb, "state.json");
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify({ last_sync: new Date().toISOString() }));
}

function lexcatCommands(logPath) {
  return readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .map((args) => ["build", "sync", "query", "export-representation"].find((candidate) => args.includes(candidate)));
}

function indexWithFakeLexcat(cacheDir, kb = "test-kb") {
  const env = { WIKIKB_LEXCAT_BIN: writeFakeLexcatCli(cacheDir) };
  const indexed = run([kb, "index", "--force"], cacheDir, env);
  assert.equal(indexed.status, 0, indexed.stderr);
  return env;
}

function writeFakeLexcatCli(cacheDir) {
  const bin = join(cacheDir, "fake-lexcat");
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
if (process.env.WIKIKB_FAKE_LEXCAT_LOG) fs.appendFileSync(process.env.WIKIKB_FAKE_LEXCAT_LOG, JSON.stringify(args) + "\\n");
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const indexPath = option("--index") || "lexcat.db";
const command = ["build", "sync", "query", "export-representation"].find((candidate) => args.includes(candidate));

// Mirrors LexCAT's default --frontmatter=payload: the block is stripped out of
// the indexed text and carried on the chunk payload instead.
const splitDocument = (raw) => {
  const fields = {};
  if (!raw.startsWith("---\\n")) return { fields: null, text: raw };
  const end = raw.indexOf("\\n---\\n", 3);
  if (end === -1) return { fields: null, text: raw };
  for (const line of raw.slice(4, end).split("\\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const value = line.slice(separator + 1).trim();
    fields[line.slice(0, separator).trim()] =
      value.length > 1 && value.startsWith('"') && value.endsWith('"') ? JSON.parse(value) : value;
  }
  return { fields, text: raw.slice(end + 5) };
};

const readCorpus = (corpus) =>
  fs.readdirSync(corpus)
    .filter((name) => name.endsWith(".md"))
    .map((entry) => {
      const parsed = splitDocument(fs.readFileSync(path.join(corpus, entry), "utf8"));
      return {
        chunk_id: entry,
        doc_id: entry,
        text: parsed.text,
        nature: "text",
        provider: "text-files",
        kind: parsed.fields ? "frontmatter" : "text",
        payload: parsed.fields ? { fields: parsed.fields, format: "yaml" } : null,
      };
    });

if (command === "build" || command === "sync") {
  if (process.env.WIKIKB_FAKE_LEXCAT_SKIP_INDEX === "1") process.exit(0);
  const corpus = args[args.indexOf(command) + 1];
  const chunks = process.env.WIKIKB_FAKE_LEXCAT_EMPTY_INDEX === "1" ? [] : readCorpus(corpus);
  // Real LexCAT keeps everything in the one file named by --index, so the fake
  // does too: a scratch index that gets renamed carries its chunks along.
  fs.writeFileSync(indexPath, JSON.stringify(chunks));
  process.stderr.write("fusing " + chunks.length + " text file(s) and 0 provider(s)\\n");
  // A collapsed vocabulary is the failure mode where chunks are indexed but
  // nothing is retrievable, so it has to be expressible independently.
  const terms = process.env.WIKIKB_FAKE_LEXCAT_NO_TERMS === "1" ? 0 : chunks.length * 5;
  if (args.includes("--json")) {
    const report = { index: indexPath, chunks: chunks.length, terms: terms, unreachable_chunks: 0 };
    if (command === "sync") {
      Object.assign(report, { dry_run: false, added: chunks.length, changed: 0, unchanged: 0, removed: 0 });
    }
    process.stdout.write(JSON.stringify(report) + "\\n");
  } else {
    const verb = command === "sync" ? "synced" : "indexed";
    process.stdout.write(verb + " " + chunks.length + " chunk(s), " + terms + " term(s) -> " + indexPath + "\\n");
  }
} else if (command === "query") {
  if (process.env.WIKIKB_FAKE_LEXCAT_UNPARSEABLE === "1") {
    process.stdout.write("not json at all\\n");
    process.exit(0);
  }
  if (process.env.WIKIKB_FAKE_LEXCAT_EMPTY_QUERY === "1") {
    process.stdout.write(JSON.stringify({ mode: "lexical", text_available: true, hits: [] }) + "\\n");
    process.exit(0);
  }
  if (process.env.WIKIKB_FAKE_LEXCAT_UNKNOWN_CHUNK === "1") {
    // A ranked chunk whose text could not be read back carries no text at all.
    const orphan = { row: 1, score: 9, chunk_id: "no-such-chunk", doc_id: "no-such-chunk", text: "", payload: null };
    process.stdout.write(JSON.stringify({ mode: "lexical", text_available: true, hits: [orphan] }) + "\\n");
    process.exit(0);
  }
  const term = args[args.indexOf("query") + 1].toLowerCase().trim().split(" ")[0];
  const chunks = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, "utf8")) : [];
  const limit = Number(option("--n") || 10);
  const hits = chunks
    .map((chunk, row) => ({ ...chunk, row, score: chunk.text.toLowerCase().includes(term) ? 2 : 0.5 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  process.stderr.write("mode: Lexical\\n");
  process.stdout.write(JSON.stringify({ mode: "lexical", text_available: true, hits }) + "\\n");
} else {
  process.stderr.write("unsupported fake LexCAT command\\n");
  process.exitCode = 2;
}
`);
  chmodSync(bin, 0o755);
  return bin;
}

function gitOk(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function executableOnPath(name) {
  for (const dir of (process.env.PATH || "").split(":")) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`${name} is not available on PATH`);
}

test("sync never persists GitHub credentials in the cached remote", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  const fixtureDir = mkdtempSync(join(tmpdir(), "wikikb-git-fixture-"));
  const seedDir = join(fixtureDir, "seed");
  const remoteDir = join(fixtureDir, "wiki.git");
  mkdirSync(seedDir, { recursive: true });
  gitOk(["init", "-b", "main"], seedDir);
  gitOk(["config", "user.name", "WikiKB Test"], seedDir);
  gitOk(["config", "user.email", "wikikb-test@example.com"], seedDir);
  writeFileSync(join(seedDir, "Home.md"), "# Test Wiki\n");
  gitOk(["add", "Home.md"], seedDir);
  gitOk(["commit", "-m", "seed"], seedDir);
  gitOk(["init", "--bare", remoteDir], fixtureDir);
  gitOk(["remote", "add", "origin", remoteDir], seedDir);
  gitOk(["push", "-u", "origin", "main"], seedDir);
  gitOk(["symbolic-ref", "HEAD", "refs/heads/main"], remoteDir);

  const fakeBin = join(fixtureDir, "bin");
  mkdirSync(fakeBin, { recursive: true });
  const fakeGit = join(fakeBin, "git");
  writeFileSync(
    fakeGit,
    `#!/bin/sh
if [ "$1" = "clone" ]; then
  requested="$2"
  destination="$3"
  "$REAL_GIT" clone "$FAKE_REMOTE" "$destination" || exit $?
  "$REAL_GIT" -C "$destination" remote set-url origin "$requested"
  exit $?
fi
if [ "$1" = "pull" ]; then
  exec "$REAL_GIT" pull --ff-only "$FAKE_REMOTE" main
fi
exec "$REAL_GIT" "$@"
`,
  );
  chmodSync(fakeGit, 0o755);

  assert.equal(run(["add", "test-kb", testSlug], cacheDir).status, 0);
  const anonymousEnv = {
    PATH: `${fakeBin}:${process.env.PATH}`,
    REAL_GIT: executableOnPath("git"),
    FAKE_REMOTE: remoteDir,
    WIKIKB_GITHUB_TOKEN: "",
  };
  const firstSync = run(["test-kb", "sync"], cacheDir, anonymousEnv);
  assert.equal(firstSync.status, 0, firstSync.stderr);

  const wikiDir = join(cacheDir, "test-kb", "wiki");
  const cleanUrl = "https://github.com/owner/demo-repo.wiki.git";
  assert.equal(gitOk(["remote", "get-url", "origin"], wikiDir), cleanUrl);

  const legacyRemote = `https://${"x-access-token"}:legacy-token@github.com/owner/demo-repo.wiki.git`;
  gitOk(["remote", "set-url", "origin", legacyRemote], wikiDir);
  const secondSync = run(["test-kb", "sync"], cacheDir, { ...anonymousEnv, WIKIKB_GITHUB_TOKEN: "release-test-token" });
  assert.equal(secondSync.status, 0, secondSync.stderr);
  assert.equal(gitOk(["remote", "get-url", "origin"], wikiDir), cleanUrl);
  assert.doesNotMatch(readFileSync(join(wikiDir, ".git", "config"), "utf8"), /x-access-token|github_pat_/);
});

test("shared wiki cache restores across clients and refreshes after source changes", { skip: process.platform === "win32" }, () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "wikikb-shared-cache-"));
  const seedDir = join(fixtureDir, "seed");
  const remoteDir = join(fixtureDir, "wiki.git");
  mkdirSync(join(seedDir, "sources"), { recursive: true });
  gitOk(["init", "-b", "main"], seedDir);
  gitOk(["config", "user.name", "WikiKB Test"], seedDir);
  gitOk(["config", "user.email", "wikikb-test@example.com"], seedDir);
  writeFileSync(join(seedDir, "Home.md"), "# Test Wiki\n");
  writeFileSync(join(seedDir, "sources", "shared.md"), "# Shared Fact\n\nThe first shared-cache fact is heliotrope.\n");
  gitOk(["add", "."], seedDir);
  gitOk(["commit", "-m", "seed"], seedDir);
  gitOk(["init", "--bare", remoteDir], fixtureDir);
  gitOk(["remote", "add", "origin", remoteDir], seedDir);
  gitOk(["push", "-u", "origin", "main"], seedDir);
  gitOk(["symbolic-ref", "HEAD", "refs/heads/main"], remoteDir);

  const cleanRemote = `https://github.com/${testSlug}.wiki.git`;
  const fakeBinDir = join(fixtureDir, "bin");
  mkdirSync(fakeBinDir, { recursive: true });
  const fakeGit = join(fakeBinDir, "git");
  writeFileSync(fakeGit, `#!/bin/sh
if [ "$1" = "push" ] && [ -n "$FAIL_PUSH_ALWAYS" ]; then
  echo "simulated offline push" >&2
  exit 42
fi
exec "$REAL_GIT" -c "url.$FAKE_REMOTE.insteadOf=$CLEAN_REMOTE" "$@"
`);
  chmodSync(fakeGit, 0o755);
  const baseEnv = {
    PATH: `${fakeBinDir}:${process.env.PATH}`,
    REAL_GIT: executableOnPath("git"),
    FAKE_REMOTE: remoteDir,
    CLEAN_REMOTE: cleanRemote,
    WIKIKB_GITHUB_TOKEN: "shared-cache-test-token",
    GIT_AUTHOR_NAME: "WikiKB Test",
    GIT_AUTHOR_EMAIL: "wikikb-test@example.com",
    GIT_COMMITTER_NAME: "WikiKB Test",
    GIT_COMMITTER_EMAIL: "wikikb-test@example.com",
  };

  const cacheA = mkdtempSync(join(tmpdir(), "wikikb-client-a-"));
  const logA = join(cacheA, "commands.jsonl");
  const envA = { ...baseEnv, WIKIKB_LEXCAT_BIN: writeFakeLexcatCli(cacheA), WIKIKB_FAKE_LEXCAT_LOG: logA };
  assert.equal(run(["add", "test-kb", testSlug], cacheA, envA).status, 0);
  assert.equal(run(["test-kb", "sync"], cacheA, envA).status, 0);
  const built = run(["test-kb", "index"], cacheA, envA);
  assert.equal(built.status, 0, built.stderr);
  assert.match(built.stderr, /Shared index published/);

  const cacheFiles = gitOk(["--git-dir", remoteDir, "ls-tree", "-r", "--name-only", "wikikb-cache-v1"], fixtureDir).split("\n");
  assert.ok(cacheFiles.some((path) => path.endsWith(".manifest.json")));
  assert.ok(cacheFiles.some((path) => path.endsWith(".tar.gz")));
  assert.ok(cacheFiles.every((path) => !path.endsWith(".md")), "cache branch must not expose wiki pages");
  const rootCommit = gitOk(["--git-dir", remoteDir, "rev-list", "--parents", "-n", "1", "wikikb-cache-v1"], fixtureDir).split(/\s+/);
  assert.equal(rootCommit.length, 1, "shared cache branch should be rewritten as a root snapshot");
  const cacheCommitBeforeQuery = rootCommit[0];

  const cacheB = mkdtempSync(join(tmpdir(), "wikikb-client-b-"));
  const logB = join(cacheB, "commands.jsonl");
  const envB = { ...baseEnv, WIKIKB_LEXCAT_BIN: writeFakeLexcatCli(cacheB), WIKIKB_FAKE_LEXCAT_LOG: logB };
  assert.equal(run(["add", "test-kb", testSlug], cacheB, envB).status, 0);
  const restored = run(["test-kb", "search", "heliotrope"], cacheB, envB);
  assert.equal(restored.status, 0, restored.stderr);
  assert.match(restored.stdout, /Shared Fact/);
  let commandsB = lexcatCommands(logB);
  assert.deepEqual(commandsB, ["query"]);
  assert.equal(gitOk(["--git-dir", remoteDir, "rev-parse", "wikikb-cache-v1"], fixtureDir), cacheCommitBeforeQuery);

  writeFileSync(join(seedDir, "sources", "shared.md"), "# Shared Fact\n\nThe refreshed shared-cache fact is vermilion.\n");
  gitOk(["add", "sources/shared.md"], seedDir);
  gitOk(["commit", "-m", "refresh source"], seedDir);
  gitOk(["push"], seedDir);
  const refreshed = run(["test-kb", "search", "vermilion"], cacheB, envB);
  assert.equal(refreshed.status, 0, refreshed.stderr);
  assert.match(refreshed.stdout, /refreshed shared-cache fact/);
  commandsB = lexcatCommands(logB);
  // The restored index matches the current build contract, so a changed source
  // is reconciled in place rather than rebuilt from scratch.
  assert.equal(commandsB.filter((command) => command === "sync").length, 1);
  assert.equal(commandsB.filter((command) => command === "build").length, 0);

  const cacheC = mkdtempSync(join(tmpdir(), "wikikb-client-c-"));
  const logC = join(cacheC, "commands.jsonl");
  const envC = { ...baseEnv, WIKIKB_LEXCAT_BIN: writeFakeLexcatCli(cacheC), WIKIKB_FAKE_LEXCAT_LOG: logC };
  assert.equal(run(["add", "test-kb", testSlug], cacheC, envC).status, 0);
  const latest = run(["test-kb", "search", "vermilion"], cacheC, envC);
  assert.equal(latest.status, 0, latest.stderr);
  assert.match(latest.stdout, /refreshed shared-cache fact/);
  const commandsC = lexcatCommands(logC);
  assert.deepEqual(commandsC, ["query"]);

  const offlineSource = join(fixtureDir, "offline.md");
  writeFileSync(offlineSource, "# Offline Fact\n\nThe locally queued fact is celadon.\n");
  const offline = run(["test-kb", "ingest", offlineSource], cacheC, { ...envC, FAIL_PUSH_ALWAYS: "1" });
  assert.notEqual(offline.status, 0);
  assert.match(offline.stderr, /could not publish 1 wiki commit/);
  assert.match(offline.stderr, /simulated offline push/);
  const unpublished = spawnSync("git", ["--git-dir", remoteDir, "cat-file", "-e", "main:sources/offline-fact.md"]);
  assert.notEqual(unpublished.status, 0);

  const synchronized = run(["test-kb", "index"], cacheC, envC);
  assert.equal(synchronized.status, 0, synchronized.stderr);
  assert.match(gitOk(["--git-dir", remoteDir, "show", "main:sources/offline-fact.md"], fixtureDir), /celadon/);

  const cacheD = mkdtempSync(join(tmpdir(), "wikikb-client-d-"));
  const logD = join(cacheD, "commands.jsonl");
  const envD = { ...baseEnv, WIKIKB_LEXCAT_BIN: writeFakeLexcatCli(cacheD), WIKIKB_FAKE_LEXCAT_LOG: logD };
  assert.equal(run(["add", "test-kb", testSlug], cacheD, envD).status, 0);
  const eventual = run(["test-kb", "search", "celadon"], cacheD, envD);
  assert.equal(eventual.status, 0, eventual.stderr);
  assert.match(eventual.stdout, /Offline Fact/);
  const commandsD = lexcatCommands(logD);
  assert.deepEqual(commandsD, ["query"]);

  if (vendoredLexcatArtifact) {
    const cacheE = mkdtempSync(join(tmpdir(), "wikikb-client-real-producer-"));
    const realEnv = { ...baseEnv, WIKIKB_LEXCAT_BIN: "", WIKIKB_FAKE_LEXCAT_LOG: "" };
    assert.equal(run(["add", "test-kb", testSlug], cacheE, realEnv).status, 0);
    const realBuild = run(["test-kb", "index", "--force"], cacheE, realEnv);
    assert.equal(realBuild.status, 0, realBuild.stderr);
    assert.match(realBuild.stdout, new RegExp(`LexCAT ${vendoredLexcatManifest.version.replace(/\./g, "\\.")}`));

    const cacheF = mkdtempSync(join(tmpdir(), "wikikb-client-real-consumer-"));
    assert.equal(run(["add", "test-kb", testSlug], cacheF, realEnv).status, 0);
    const realRestore = run(["test-kb", "index"], cacheF, realEnv);
    assert.equal(realRestore.status, 0, realRestore.stderr);
    assert.match(realRestore.stdout, /restored from shared wiki cache/);
    const realSearch = run(["test-kb", "search", "celadon", "--top", "3"], cacheF, realEnv);
    assert.equal(realSearch.status, 0, realSearch.stderr);
    assert.match(realSearch.stdout, /Offline Fact/);
  }
});

test("push publishes only its ingest and retries a transient failure after indexing", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "wikikb-test-"));
  const fixtureDir = mkdtempSync(join(tmpdir(), "wikikb-push-fixture-"));
  const seedDir = join(fixtureDir, "seed");
  const remoteDir = join(fixtureDir, "wiki.git");
  mkdirSync(seedDir, { recursive: true });
  gitOk(["init", "-b", "main"], seedDir);
  gitOk(["config", "user.name", "WikiKB Test"], seedDir);
  gitOk(["config", "user.email", "wikikb-test@example.com"], seedDir);
  writeFileSync(join(seedDir, "Home.md"), "# Test Wiki\n");
  gitOk(["add", "Home.md"], seedDir);
  gitOk(["commit", "-m", "seed"], seedDir);
  gitOk(["init", "--bare", remoteDir], fixtureDir);
  gitOk(["remote", "add", "origin", remoteDir], seedDir);
  gitOk(["push", "-u", "origin", "main"], seedDir);
  gitOk(["symbolic-ref", "HEAD", "refs/heads/main"], remoteDir);

  const cleanRemote = `https://github.com/${testSlug}.wiki.git`;
  const fakeBin = join(fixtureDir, "bin");
  const failMarker = join(fixtureDir, "push-failed-once");
  mkdirSync(fakeBin, { recursive: true });
  const fakeGit = join(fakeBin, "git");
  writeFileSync(
    fakeGit,
    `#!/bin/sh
if [ "$1" = "push" ] && [ -n "$FAIL_PUSH_ONCE" ] && [ ! -e "$FAIL_PUSH_ONCE" ]; then
  : > "$FAIL_PUSH_ONCE"
  echo "simulated push failure" >&2
  exit 42
fi
exec "$REAL_GIT" -c "url.$FAKE_REMOTE.insteadOf=$CLEAN_REMOTE" "$@"
`,
  );
  chmodSync(fakeGit, 0o755);

  const gitEnv = {
    PATH: `${fakeBin}:${process.env.PATH}`,
    REAL_GIT: executableOnPath("git"),
    FAKE_REMOTE: remoteDir,
    CLEAN_REMOTE: cleanRemote,
    WIKIKB_GITHUB_TOKEN: "release-test-token",
    GIT_AUTHOR_NAME: "WikiKB Test",
    GIT_AUTHOR_EMAIL: "wikikb-test@example.com",
    GIT_COMMITTER_NAME: "WikiKB Test",
    GIT_COMMITTER_EMAIL: "wikikb-test@example.com",
  };
  assert.equal(run(["add", "test-kb", testSlug], cacheDir, gitEnv).status, 0);
  const synced = run(["test-kb", "sync"], cacheDir, gitEnv);
  assert.equal(synced.status, 0, synced.stderr);

  const draft = join(fixtureDir, "draft.md");
  const published = join(fixtureDir, "published.md");
  const retry = join(fixtureDir, "retry.md");
  writeFileSync(draft, "# Local Draft\n\nThis must remain local.\n");
  writeFileSync(published, "# Published Release\n\nThis page is intended for the remote.\n");
  writeFileSync(retry, "# Retry Release\n\nThis page survives a failed push.\n");

  const localOnly = run(["test-kb", "ingest", draft, "--no-push"], cacheDir, gitEnv);
  assert.equal(localOnly.status, 0, localOnly.stderr);
  const publish = run(["test-kb", "ingest", published], cacheDir, gitEnv);
  assert.equal(publish.status, 0, publish.stderr);
  assert.match(gitOk(["--git-dir", remoteDir, "show", "main:sources/published-release.md"], fixtureDir), /intended for the remote/);
  const remoteDraft = spawnSync("git", ["--git-dir", remoteDir, "cat-file", "-e", "main:sources/local-draft.md"]);
  assert.notEqual(remoteDraft.status, 0, "--no-push page leaked into a later publish");

  const wikiDir = join(cacheDir, "test-kb", "wiki");
  assert.match(gitOk(["status", "--short"], wikiDir), /sources\/local-draft\.md/);
  const failed = run(["test-kb", "ingest", retry], cacheDir, { ...gitEnv, FAIL_PUSH_ONCE: failMarker });
  assert.equal(failed.status, 0, failed.stderr);
  assert.match(failed.stderr, /simulated push failure/);
  assert.match(failed.stderr, /retry once while rebuilding the index/);
  assert.match(gitOk(["--git-dir", remoteDir, "show", "main:sources/retry-release.md"], fixtureDir), /survives a failed push/);

  const retried = run(["test-kb", "ingest", retry], cacheDir, { ...gitEnv, FAIL_PUSH_ONCE: failMarker });
  assert.equal(retried.status, 0, retried.stderr);
  assert.match(gitOk(["--git-dir", remoteDir, "show", "main:sources/retry-release.md"], fixtureDir), /survives a failed push/);
  assert.doesNotMatch(readFileSync(join(wikiDir, ".git", "config"), "utf8"), /release-test-token|x-access-token/);
});
