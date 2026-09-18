#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const errors = [];
let checkedLinks = 0;

function rel(...parts) {
  return path.join(repoRoot, ...parts);
}

function read(relativePath) {
  return fs.readFileSync(rel(relativePath), "utf8");
}

function readJson(relativePath) {
  try {
    return JSON.parse(read(relativePath));
  } catch (error) {
    errors.push(`Invalid JSON: ${relativePath} (${error.message})`);
    return {};
  }
}

function requireFile(relativePath) {
  const absolutePath = rel(relativePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    errors.push(`Missing required release file: ${relativePath}`);
    return;
  }
  if (fs.statSync(absolutePath).size === 0) errors.push(`Required release file is empty: ${relativePath}`);
}

function repositoryFiles() {
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status === 0) {
    return result.stdout
      .split("\0")
      .filter(Boolean)
      .filter((relativePath) => fs.existsSync(rel(relativePath)) && fs.statSync(rel(relativePath)).isFile());
  }

  const discovered = [];
  const excludedDirectories = new Set([".git", ".index-store", "dist", "node_modules", "release"]);
  function walk(directory, relativeDirectory = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
      const relativePath = path.join(relativeDirectory, entry.name);
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolutePath, relativePath);
      else if (entry.isFile() && entry.name !== ".env" && entry.name !== ".DS_Store") discovered.push(relativePath);
    }
  }
  walk(repoRoot);
  return discovered;
}

const files = repositoryFiles();
const fileSet = new Set(files);
const forbiddenSourceReferences = [
  ["msr", "central"].join("-"),
  `${"githubnext"}/${["repo", "mind", "light"].join("-")}`,
  ["dev", "azure", "com"].join("."),
  ["pkgs", "dev", "azure", "com"].join("."),
];
const forbiddenBinaryReferences = [
  `${["msr", "central"].join("-")}/${["so", "ma"].join("")}`,
  `${["msr", "central"].join("-")}/${["lex", "cat"].join("")}`,
];

for (const required of [
  ".github/actionlint.yaml",
  "README.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "INSTALL.md",
  "LICENSE",
  "SKILL.md",
  "docs/agent-memory.md",
  "docs/architecture.md",
  "docs/configuration.md",
  "docs/release-checklist.md",
  "docs/release-scope.md",
  "package.json",
  "package-lock.json",
  "tools/agentic-install/runtime-package.json",
  "tools/agentic-install/runtime-package-lock.json",
  "tools/install-agentic.js",
  "tools/package-release.js",
  "tools/wikikb-local/src/main.ts",
  "tools/wikikb-local/assets/wikikb-memory/SKILL.md",
  "tools/wikikb-local/assets/wikikb-memory/agents/openai.yaml",
  "tools/wikikb-local/tsconfig.json",
  "vendor/lexcat/README.md",
  "vendor/lexcat/THIRD_PARTY_NOTICES.txt",
  "vendor/lexcat/manifest.json",
  "gh-wikikb",
]) {
  requireFile(required);
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const runtimePackage = readJson("tools/agentic-install/runtime-package.json");
const runtimePackageLock = readJson("tools/agentic-install/runtime-package-lock.json");
const cliSource = read("tools/wikikb-local/src/main.ts");
const cliVersion = cliSource.match(/const VERSION = "([^"]+)"/)?.[1];
const installGuide = read("INSTALL.md");
const agenticInstaller = read("tools/install-agentic.js");
const ghAwVersion = "v0.83.4";
const currentActionPins = new Map([
  ["actions/cache", "55cc8345863c7cc4c66a329aec7e433d2d1c52a9"],
  ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
  ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
]);

if (packageJson.private !== true) errors.push("Root package.json must remain private; WikiKB is released from source, not npm.");
if (packageJson.engines?.node !== ">=22") errors.push("package.json must declare Node.js >=22.");
if (!packageJson.scripts?.["validate:release"]) errors.push("package.json is missing validate:release.");
if (!packageJson.scripts?.["release:check"]) errors.push("package.json is missing release:check.");
if (!packageJson.scripts?.["bundle:check"]) errors.push("package.json is missing bundle:check.");
if (!packageJson.scripts?.["package:release"]) errors.push("package.json is missing package:release.");
if (!packageJson.scripts?.["test:wkb:node"]?.includes("--test-concurrency=1")) {
  errors.push("Node test files must run sequentially because installer coverage rebuilds the shared CLI output.");
}
if (packageLock.version !== packageJson.version) errors.push("package-lock.json version does not match package.json.");
if (packageLock.packages?.[""]?.engines?.node !== ">=22") errors.push("package-lock.json must require Node.js >=22.");
if (cliVersion !== packageJson.version) errors.push("CLI VERSION does not match package.json.");
if (runtimePackage.version !== packageJson.version || runtimePackageLock.version !== packageJson.version) {
  errors.push("Agentic installer runtime versions must match package.json.");
}
if (runtimePackageLock.packages?.[""]?.name !== runtimePackage.name) {
  errors.push("Agentic installer runtime package-lock does not match its package name.");
}
if (runtimePackage.engines?.node !== ">=22" || runtimePackageLock.packages?.[""]?.engines?.node !== ">=22") {
  errors.push("Agentic installer runtime metadata must require Node.js >=22.");
}
if (!read("README.md").includes("Install WikiKB using https://github.com/githubnext/wikikb/blob/main/INSTALL.md")) {
  errors.push("README must lead installation with the agent-guided INSTALL.md prompt.");
}
if (
  !installGuide.includes("at least one") ||
  !installGuide.includes("has_wiki=true") ||
  !installGuide.includes("Settings > General > Features") ||
  !/visibility`? to be `?PRIVATE/i.test(installGuide) ||
  !/prompt\s+injection/i.test(installGuide) ||
  !installGuide.includes("Copilot Requests") ||
  !installGuide.includes("gh aw secrets bootstrap") ||
  !installGuide.includes("wkb add REPO_ALIAS OWNER/REPO")
) {
  errors.push("INSTALL.md must require one enabled, initialized, and CLI-verified GitHub wiki.");
}
if (!agenticInstaller.includes(".github/wikikb") || !agenticInstaller.includes("Refusing to overwrite")) {
  errors.push("Agentic installer must use the isolated target layout and reject changed conflicts.");
}
if (!agenticInstaller.includes(".github/aw/actions-lock.json") || !agenticInstaller.includes("--confirm-private-repo")) {
  errors.push("Agentic installer must copy the action pin lock and require private-repository confirmation.");
}
if (!agenticInstaller.includes('.github/workflows/aw.json')) {
  errors.push("Agentic installer must preserve the disabled gh-aw maintenance configuration.");
}
if (!agenticInstaller.includes('defaultBranch !== "main"')) {
  errors.push("Agentic installer must preserve byte-identical workflow sources for the default main branch.");
}
if (!read("tools/wikikb-local/test/release.mjs").includes("default-branch agentic install preserves compiled workflow integrity")) {
  errors.push("Release tests must guard default-branch workflow integrity after agentic installation.");
}
for (const reference of [installGuide, read("docs/release-checklist.md")]) {
  if (!reference.includes(`gh-aw --pin ${ghAwVersion}`)) errors.push(`Every gh-aw installation must pin ${ghAwVersion}.`);
}
if (fileSet.has("tools/search.sh")) errors.push("Legacy alternate search helper must not ship.");
if (fileSet.has("tests/integration-test.sh")) errors.push("Legacy destructive wiki-reset helper must not ship.");
if (files.some((file) => file.startsWith("tools/wikikb-local/evals/"))) errors.push("Stale pre-release evaluation tools must not ship.");
if (fileSet.has("docs/plan.md")) errors.push("Roadmap-only documentation must not ship in the release surface.");
if (files.some((file) => /(^|\/)changelog(?:\.[^/]+)?$/i.test(file))) {
  errors.push("A changelog must not ship in the first release.");
}
if (cliSource.includes('case "issues"')) errors.push("Undocumented ingest-issues alias must not ship.");
for (const retiredEnv of ["WIKIKB_LLM_TOKEN", "WIKIKB_LLM_MODEL", "WIKIKB_LLM_API"]) {
  if (cliSource.includes(retiredEnv)) errors.push(`Ambiguous AI environment alias remains: ${retiredEnv}.`);
}
if (/\blexicalSearch\b|used lexical fallback|tools\/search\.sh/i.test(cliSource)) {
  errors.push("CLI source contains an alternate retrieval path.");
}
if (!cliSource.includes('arg === "--ai" || arg === "--no-ai"') || !cliSource.includes("if (!parsed.generate)")) {
  errors.push("CLI must implement the documented explicit --ai and query --no-ai modes.");
}
if (!cliSource.includes('const SHARED_CACHE_BRANCH = "wikikb-cache-v1"') || !cliSource.includes("--force-with-lease=")) {
  errors.push("CLI source is missing the versioned shared wiki index protocol.");
}

const agenticWorkflows = ["compile-kb", "explore-kb", "lint-kb", "query-kb", "remember-kb", "search-kb"];
for (const workflow of agenticWorkflows) {
  const body = read(`tools/agentic-install/template/.github/workflows/${workflow}.md`);
  const lock = read(`tools/agentic-install/template/.github/workflows/${workflow}.lock.yml`);
  for (const required of [
    "types: [labeled]",
    "github.event.repository.private == true",
    "github: false",
    "bash: []",
    "edit: false",
    "bare: true",
    "inlined-imports: true",
    "--available-tools=safeoutputs",
    "--deny-tool=write",
    "--excluded-tools=write,shell,web_fetch,github",
    "threat-detection: false",
  ]) {
    if (!body.includes(required)) errors.push(`${workflow} is missing the agent security boundary: ${required}`);
  }
  for (const forbidden of ["github-mcp-server", "--allow-tool shell", "--allow-all-tools", "--allow-all-paths", "{{#runtime-import", "\n  detection:\n"]) {
    if (lock.includes(forbidden)) errors.push(`${workflow}.lock.yml exposes a forbidden agent capability: ${forbidden.trim()}`);
  }
  for (const required of [
    "--available-tools=safeoutputs",
    "--deny-tool=write",
    "--excluded-tools=write,shell,web_fetch,github",
    "--no-custom-instructions",
    'GH_AW_REQUIRED_ROLES: "admin,maintainer,write"',
    "check_membership.cjs",
    `\"compiler_version\":\"${ghAwVersion}\"`,
  ]) {
    if (!lock.includes(required)) errors.push(`${workflow}.lock.yml is missing the compiled agent restriction: ${required}`);
  }
}

for (const workflow of ["query-kb", "search-kb"]) {
  const body = read(`tools/agentic-install/template/.github/workflows/${workflow}.md`);
  const command = workflow === "query-kb" ? '"query"' : '"search"';
  if (!body.includes(command) || !body.includes("LexCAT") || !body.includes("safe-outputs:")) {
    errors.push(`${workflow} must execute LexCAT retrieval through a constrained job.`);
  }
  if (!body.includes("$GITHUB_WORKSPACE/.github/wikikb/package.json")) {
    errors.push(`${workflow} must support the isolated agentic-install runtime.`);
  }
  if (/tools\/search\.sh|wiki-mirror.*search|repository grep/i.test(body) && !/Do not substitute repository grep/i.test(body)) {
    errors.push(`${workflow} contains an alternate retrieval instruction.`);
  }
}

if (
  !cliSource.includes("the provider attempted a tool call in a text-only request") ||
  !cliSource.includes("messages: [{ role: \"user\", content: prompt }]") ||
  !cliSource.includes("input: [{ role: \"user\", content: prompt }]")
) {
  errors.push("AI providers must receive text-only requests and reject tool-call responses.");
}

const compileWorkflow = read("tools/agentic-install/template/.github/workflows/compile-kb.md");
if (!compileWorkflow.includes('["wikikb", "ingest", source]') || !compileWorkflow.includes("invokes `wkb ingest` directly")) {
  errors.push("compile-kb must route issue sources through wkb ingest.");
}
if (!compileWorkflow.includes("wikikb-wiki-writes") || !compileWorkflow.includes("issues:") || !compileWorkflow.includes("kb-ingest")) {
  errors.push("compile-kb must serialize wiki writers and accept only labeled issue ingestion.");
}
if (/^\s{2}push:|\braw\/|\bcooked\/|gh pr create|\[compile-kb\]/m.test(compileWorkflow)) {
  errors.push("compile-kb must not retain repository file-drop or archive behavior.");
}
if (!read("tools/agentic-install/template/.github/workflows/remember-kb.md").includes("wikikb-wiki-writes")) {
  errors.push("remember-kb must share the serialized wiki-write concurrency group.");
}
if (/^\s+push-wiki:/m.test(compileWorkflow)) {
  errors.push("compile-kb must not maintain a separate direct wiki-writing ingestion path.");
}
if (!compileWorkflow.includes("WIKIKB_ISSUE_NUMBER") || !compileWorkflow.includes("-issue-${issueNumber}.md")) {
  errors.push("compile-kb pasted sources must use an issue-scoped identity so repeated titles cannot overwrite one another.");
}
const rememberWorkflow = read("tools/agentic-install/template/.github/workflows/remember-kb.md");
if (!rememberWorkflow.includes("WIKIKB_ISSUE_NUMBER") || !rememberWorkflow.includes("-issue-${issueNumber}.md")) {
  errors.push("remember-kb pages must use an issue-scoped identity so repeated titles cannot overwrite one another.");
}

const indexWorkflow = read("tools/agentic-install/template/.github/workflows/index-wiki.yml");
if (!indexWorkflow.includes('workflows: ["Compile Knowledge Base", "Remember Knowledge"]') || !indexWorkflow.includes("contents: write")) {
  errors.push("index-wiki must refresh the shared index after every supported Agentic Workflow write.");
}
if (!indexWorkflow.includes("$GITHUB_WORKSPACE/.github/wikikb/package.json")) {
  errors.push("index-wiki must support the isolated agentic-install runtime.");
}

const syncLabelsWorkflow = read("tools/agentic-install/template/.github/workflows/sync-labels.yml");
if (!syncLabelsWorkflow.includes(".github/wikikb/labels.yml") || !syncLabelsWorkflow.includes("fs.existsSync")) {
  errors.push("sync-labels must prefer agentic-install labels without breaking a source checkout.");
}
const syncWikiWorkflow = read("tools/agentic-install/template/.github/workflows/sync-wiki.yml");
if (!syncWikiWorkflow.includes('workflows: ["Compile Knowledge Base", "Remember Knowledge"]') || !syncWikiWorkflow.includes("gh pr create")) {
  errors.push("sync-wiki must mirror every workflow writer through a reviewable pull request.");
}
for (const workflow of ["compile-kb.md", "remember-kb.md", "index-wiki.yml", "integration.yml", "release.yml", "sync-wiki.yml"]) {
  const workflowRoot = ["integration.yml", "release.yml"].includes(workflow)
    ? ".github/workflows"
    : "tools/agentic-install/template/.github/workflows";
  const body = read(`${workflowRoot}/${workflow}`);
  if (!body.includes("cancel-in-progress: false") || !body.includes("queue: max")) {
    errors.push(`${workflow} must queue critical runs instead of silently replacing pending work.`);
  }
}
if (!read(".github/actionlint.yaml").includes('unexpected key "queue" for "concurrency" section')) {
  errors.push("actionlint must ignore only its stale concurrency.queue schema error.");
}
for (const workflow of ["index-wiki.yml", "init-wiki.yml", "sync-labels.yml", "sync-wiki.yml"]) {
  if (!read(`tools/agentic-install/template/.github/workflows/${workflow}`).includes("github.event.repository.private == true")) {
    errors.push(`${workflow} must stop outside a private repository.`);
  }
}
if (!read("tools/agentic-install/template/.github/aw/actions-lock.json").includes(ghAwVersion)) {
  errors.push(`The gh-aw action lock must be generated for ${ghAwVersion}.`);
}
if (!read(".github/workflows/ci.yml").includes("node: [22, 24]")) {
  errors.push("CI must test every supported Node.js LTS line: 22 and 24.");
}
for (const workflow of ["compile-kb.md", "explore-kb.md", "index-wiki.yml", "lint-kb.md", "query-kb.md", "search-kb.md"]) {
  if (!read(`tools/agentic-install/template/.github/workflows/${workflow}`).includes('node-version: "22"')) {
    errors.push(`${workflow} must use the minimum supported Node.js 22 runtime.`);
  }
}
for (const referenceFile of ["README.md", "INSTALL.md", "SKILL.md", "docs/release-checklist.md", "tools/wikikb-local/install.sh"]) {
  if (/Node(?:\.js)? 20\+|Node\.js 20 or newer|major >= 20/.test(read(referenceFile))) {
    errors.push(`End-of-life Node.js 20 remains in the supported release surface: ${referenceFile}`);
  }
}

const lexcatManifest = readJson("vendor/lexcat/manifest.json");
const rootLicense = read("LICENSE");
const packageMetadata = readJson("package.json");
if (
  !rootLicense.includes("vendor/lexcat/") ||
  !/not licensed under the MIT License/.test(rootLicense) ||
  packageMetadata.license !== "SEE LICENSE IN LICENSE"
) {
  errors.push("Root licensing metadata must exclude the vendored LexCAT binaries from the MIT grant.");
}
if (
  lexcatManifest.schema_version !== 1 ||
  lexcatManifest.name !== "LEXCAT" ||
  lexcatManifest.version !== "0.0.20" ||
  lexcatManifest.notices !== "THIRD_PARTY_NOTICES.txt" ||
  !/^[a-f0-9]{64}$/.test(lexcatManifest.notices_sha256 || "") ||
  !Number.isInteger(lexcatManifest.index_schema_version) ||
  "model" in lexcatManifest ||
  !Array.isArray(lexcatManifest.artifacts)
) {
  errors.push("vendor/lexcat/manifest.json must declare the approved model-free LexCAT 0.0.20 artifact and notice metadata.");
} else {
  const noticesPath = rel("vendor", "lexcat", lexcatManifest.notices);
  if (!fs.existsSync(noticesPath)) {
    errors.push("LexCAT third-party notice is missing.");
  } else {
    const noticesText = read(path.relative(repoRoot, noticesPath));
    if (!noticesText.includes("are not licensed under WikiKB's MIT License")) {
      errors.push("LexCAT third-party notice must state that the binaries are outside WikiKB's MIT license.");
    }
    const noticesDigest = crypto.createHash("sha256").update(fs.readFileSync(noticesPath)).digest("hex");
    if (noticesDigest !== lexcatManifest.notices_sha256) errors.push("LexCAT third-party notice checksum mismatch.");
  }
  const expectedPlatforms = new Set(["darwin/arm64", "darwin/x64", "linux/arm64", "linux/x64", "win32/x64"]);
  const seenPlatforms = new Set();
  for (const artifact of lexcatManifest.artifacts) {
    const platform = `${artifact.platform}/${artifact.arch}`;
    if (!expectedPlatforms.has(platform)) errors.push(`Unexpected LexCAT platform artifact: ${platform}`);
    if (seenPlatforms.has(platform)) errors.push(`Duplicate LexCAT platform artifact: ${platform}`);
    seenPlatforms.add(platform);
    expectedPlatforms.delete(platform);
    if (path.basename(artifact.archive || "") !== artifact.archive || path.basename(artifact.executable || "") !== artifact.executable) {
      errors.push(`Unsafe LexCAT artifact path for ${platform}.`);
      continue;
    }
    if (
      !/^[a-f0-9]{64}$/.test(artifact.upstream_sha256 || "") ||
      !/^[a-f0-9]{64}$/.test(artifact.archive_sha256 || "") ||
      !/^[a-f0-9]{64}$/.test(artifact.executable_sha256 || "")
    ) {
      errors.push(`Invalid LexCAT checksum metadata for ${platform}.`);
      continue;
    }
    if (typeof artifact.provenance !== "string" || artifact.provenance.length < 40 || /https?:\/\//i.test(artifact.provenance)) {
      errors.push(`Missing or unsafe LexCAT provenance metadata for ${platform}.`);
    }
    const archivePath = rel("vendor", "lexcat", artifact.archive);
    requireFile(path.join("vendor", "lexcat", artifact.archive));
    if (!fs.existsSync(archivePath)) continue;
    const archiveDigest = crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
    if (archiveDigest !== artifact.archive_sha256) errors.push(`LexCAT archive checksum mismatch: ${artifact.archive}`);

    const listCommand = artifact.format === "zip" ? "unzip" : "tar";
    const listArgs = artifact.format === "zip" ? ["-Z1", archivePath] : ["-tzf", archivePath];
    const listed = spawnSync(listCommand, listArgs, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    if (listed.status !== 0) {
      errors.push(`Could not inspect LexCAT archive ${artifact.archive}: ${(listed.stderr || listed.stdout || "").trim()}`);
      continue;
    }
    const rawEntries = listed.stdout.split(/\r?\n/).filter((entry) => entry && entry !== "." && entry !== "./" && !entry.endsWith("/"));
    const normalizedEntries = rawEntries.map((entry) => entry.replace(/^\.\//, ""));
    if (normalizedEntries.length !== 1 || normalizedEntries[0] !== artifact.executable) {
      errors.push(`LexCAT archive must contain only ${artifact.executable}: ${artifact.archive}`);
      continue;
    }
    const extractCommand = artifact.format === "zip" ? "unzip" : "tar";
    const extractArgs = artifact.format === "zip" ? ["-p", archivePath, rawEntries[0]] : ["-xOzf", archivePath, rawEntries[0]];
    const extracted = spawnSync(extractCommand, extractArgs, { encoding: null, maxBuffer: 64 * 1024 * 1024 });
    if (extracted.status !== 0 || !Buffer.isBuffer(extracted.stdout)) {
      errors.push(`Could not verify LexCAT executable ${artifact.executable} in ${artifact.archive}.`);
      continue;
    }
    const executableDigest = crypto.createHash("sha256").update(extracted.stdout).digest("hex");
    if (executableDigest !== artifact.executable_sha256) errors.push(`LexCAT executable checksum mismatch: ${artifact.archive}`);
    const binaryText = extracted.stdout.toString("latin1").toLowerCase();
    const wideBinaryText = binaryText.replaceAll("\0", "");
    for (const forbidden of forbiddenBinaryReferences) {
      if (binaryText.includes(forbidden) || wideBinaryText.includes(forbidden)) {
        errors.push(`Forbidden source-repository reference found in LexCAT executable: ${artifact.archive}`);
      }
    }
  }
  for (const missing of expectedPlatforms) errors.push(`Missing required LexCAT platform artifact: ${missing}`);
}

for (const scriptName of ["check", "release:check", "audit:dependencies", "bundle:check", "package:release"]) {
  const script = packageJson.scripts?.[scriptName] || "";
  if (/extensions\/|test:experimental-extensions|native.messaging/i.test(script)) {
    errors.push(`Core release script ${scriptName} includes a deferred extension check.`);
  }
}

for (const script of [
  "tools/kb-search.sh",
  "tools/install-agentic.js",
  "tools/package-release.js",
  "tools/validate-release.js",
  "tools/validate-wiki.js",
  "tools/wikikb-local/install.sh",
  "tools/wikikb-local/wkb",
  "gh-wikikb",
]) {
  requireFile(script);
  if (fs.existsSync(rel(script)) && (fs.statSync(rel(script)).mode & 0o111) === 0) {
    errors.push(`Script is not executable: ${script}`);
  }
}

for (const workflow of agenticWorkflows) {
  requireFile(`tools/agentic-install/template/.github/workflows/${workflow}.md`);
  requireFile(`tools/agentic-install/template/.github/workflows/${workflow}.lock.yml`);
}
for (const workflow of ["ci.yml", "integration.yml", "release.yml"]) {
  requireFile(`.github/workflows/${workflow}`);
}
for (const workflow of ["aw.json", "index-wiki.yml", "init-wiki.yml", "sync-labels.yml", "sync-wiki.yml"]) {
  requireFile(`tools/agentic-install/template/.github/workflows/${workflow}`);
}
if (read("tools/agentic-install/template/.github/workflows/aw.json").trim() !== '{\n  "maintenance": false\n}') {
  errors.push("gh-aw maintenance must remain disabled so no generated agentic workflow can run outside the private-repository guards.");
}
if (files.includes("tools/agentic-install/template/.github/workflows/agentics-maintenance.yml")) {
  errors.push("The unguarded generated Agentic Maintenance workflow must not be shipped.");
}

const integrationSource = read("tools/wikikb-local/test/integration.mjs");
if (/\bskip\s*:|\.skip\s*\(|WIKIKB_RUN_LIVE|RUN_LIVE/.test(integrationSource)) {
  errors.push("Integration tests must never contain skip paths or live-test opt-in flags.");
}
for (const required of [
  "require WIKIKB_TEST_REPO=owner/repository",
  "WIKIKB_INTEGRATION_TOKEN",
  "authenticated gh CLI",
  "WIKIKB_TEST_REPO must be private",
  "WIKIKB_COPILOT_TOKEN",
  "closed issues cannot activate any Agentic Workflow",
  "credential-shaped issue content is rejected without writing to the wiki",
  "is stale or differs from the release candidate",
]) {
  if (!integrationSource.includes(required)) errors.push(`Integration preflight is missing: ${required}`);
}
if (!packageJson.scripts?.check?.includes("test:wkb:integration") || !packageJson.scripts?.["release:check"]?.includes("npm run check")) {
  errors.push("The normal and release checks must include mandatory live integration tests.");
}
if (files.some((file) => /^(?:raw|cooked)(?:\/|$)/.test(file))) {
  errors.push("Retired raw/cooked repository ingestion directories must not ship.");
}

for (const file of files.filter((file) =>
  (file.startsWith(".github/workflows/") || file.startsWith("tools/agentic-install/template/.github/workflows/")) &&
  /\.(?:md|ya?ml)$/.test(file)
)) {
  const body = read(file);
  for (const match of body.matchAll(/^\s*uses:\s*([^\s#]+)\s*/gm)) {
    const reference = match[1];
    if (reference.startsWith("./")) continue;
    const pinnedAction = /^[^@]+@[a-f0-9]{40}$/.test(reference);
    const pinnedContainer = /^docker:\/\/[^@\s]+@sha256:[a-f0-9]{64}$/.test(reference);
    if (!pinnedAction && !pinnedContainer) errors.push(`Workflow action is not immutable: ${file} -> ${reference}`);
    for (const [action, sha] of currentActionPins) {
      if (reference.startsWith(`${action}@`) && reference !== `${action}@${sha}`) {
        errors.push(`Workflow action is stale: ${file} -> ${reference}; expected ${action}@${sha}`);
      }
    }
  }
}

for (const action of ["ingest", "question", "remember", "search", "lint", "explore"]) {
  requireFile(`tools/agentic-install/template/.github/ISSUE_TEMPLATE/${action}.yml`);
  if (!read("tools/agentic-install/template/.github/labels.yml").includes(`name: "kb-${action}"`)) errors.push(`Missing kb-${action} label definition.`);
}

const markdownFiles = files.filter((file) =>
  file.endsWith(".md") &&
  !file.startsWith("wiki-mirror/") &&
  !file.startsWith(".github/workflows/")
);
for (const markdownFile of markdownFiles) {
  const body = read(markdownFile);
  if (/repo[-_ ]mind/i.test(body)) errors.push(`Legacy repo-mind name remains in public documentation: ${markdownFile}`);
  for (const match of body.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, "");
    if (!target || /^(?:https?:|mailto:|#)/i.test(target)) continue;
    target = decodeURIComponent(target.split("#")[0].split("?")[0]);
    const resolved = path.resolve(path.dirname(rel(markdownFile)), target);
    checkedLinks += 1;
    if (!fs.existsSync(resolved)) errors.push(`Broken Markdown link: ${markdownFile} -> ${match[1]}`);
  }
}

const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".sh", ".ts", ".tsx", ".txt", ".yml", ".yaml"]);
const retiredProjectTerms = [
  ["ray", "cast"].join(""),
  ["chro", "me"].join(""),
];
for (const file of files) {
  const isVendorNotice = file === "vendor/lexcat/THIRD_PARTY_NOTICES.txt";
  for (const term of retiredProjectTerms) {
    if (!isVendorNotice && file.toLowerCase().includes(term)) errors.push(`Retired project term remains in repository path: ${file}`);
  }
  if (!textExtensions.has(path.extname(file))) continue;
  const body = read(file);
  for (const term of retiredProjectTerms) {
    if (!isVendorNotice && body.toLowerCase().includes(term)) errors.push(`Retired project term remains in repository text: ${file}`);
  }
  if (file.endsWith("package-lock.json") || file.endsWith(".lock.yml")) continue;
  if (/https:\/\/x-access-token:[^@\s]+@github\.com/i.test(body)) errors.push(`Credential-bearing Git remote URL found: ${file}`);
  if (/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/.test(body)) {
    errors.push(`Token-shaped literal found: ${file}`);
  }
  for (const forbidden of forbiddenSourceReferences) {
    if (!isVendorNotice && body.toLowerCase().includes(forbidden)) errors.push(`Forbidden source-repository reference found in ${file}.`);
  }
}

if (fileSet.has("tools/wikikb-local/dist/main.js")) errors.push("Generated CLI dist/main.js must not be committed.");

for (const error of errors) console.error(`error: ${error}`);
console.log(`Repository files scanned: ${files.length}`);
console.log(`Markdown links checked: ${checkedLinks}`);
console.log(`Errors: ${errors.length}`);
if (errors.length) process.exitCode = 1;
