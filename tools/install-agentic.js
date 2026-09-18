#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const sourceRoot = path.resolve(__dirname, "..");
const templateRoot = path.join(sourceRoot, "tools", "agentic-install", "template");
const args = process.argv.slice(2);
let target;
let defaultBranch;
let force = false;
let privateRepoConfirmed = false;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--target") target = args[++index];
  else if (arg === "--default-branch") defaultBranch = args[++index];
  else if (arg === "--force") force = true;
  else if (arg === "--confirm-private-repo") privateRepoConfirmed = true;
  else if (arg === "--help" || arg === "-h") {
    console.log("Usage: node tools/install-agentic.js --target <repo> --confirm-private-repo [--default-branch <branch>] [--force]");
    process.exit(0);
  } else {
    throw new Error(`Unknown option: ${arg}`);
  }
}

if (!target) throw new Error("--target is required");
if (!privateRepoConfirmed) {
  throw new Error("--confirm-private-repo is required. Agentic Workflows must only be installed in a PRIVATE knowledge-base repository because KB content can contain prompt injection.");
}
if (!defaultBranch) defaultBranch = "main";
if (!/^[A-Za-z0-9._/-]+$/.test(defaultBranch) || defaultBranch.includes("..")) {
  throw new Error(`Unsafe default branch: ${defaultBranch}`);
}

const targetRoot = fs.realpathSync(path.resolve(target));
const gitCheck = spawnSync("git", ["-C", targetRoot, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
if (gitCheck.status !== 0) throw new Error(`Target is not a Git worktree: ${targetRoot}`);
if (fs.realpathSync(gitCheck.stdout.trim()) !== targetRoot) {
  throw new Error(`--target must be the Git worktree root: ${gitCheck.stdout.trim()}`);
}
if (targetRoot === sourceRoot) throw new Error("WikiKB is already installed in its source repository");

const workflowNames = ["compile-kb", "explore-kb", "lint-kb", "query-kb", "remember-kb", "search-kb"];
const mappings = [
  [".github/workflows/aw.json", ".github/workflows/aw.json"],
  ...workflowNames.flatMap((name) => [
    [`.github/workflows/${name}.md`, `.github/workflows/${name}.md`],
    [`.github/workflows/${name}.lock.yml`, `.github/workflows/${name}.lock.yml`],
  ]),
  ...["index-wiki.yml", "init-wiki.yml", "sync-labels.yml", "sync-wiki.yml"].map((name) => [
    `.github/workflows/${name}`,
    `.github/workflows/${name}`,
  ]),
  [".github/ISSUE_TEMPLATE", ".github/ISSUE_TEMPLATE"],
  [".github/skills/wikikb-memory", ".github/skills/wikikb-memory"],
  [".github/aw/imports", ".github/aw/imports"],
  [".github/aw/actions-lock.json", ".github/aw/actions-lock.json"],
  [".github/labels.yml", ".github/wikikb/labels.yml"],
  ["tools/agentic-install/runtime-package.json", ".github/wikikb/package.json"],
  ["tools/agentic-install/runtime-package-lock.json", ".github/wikikb/package-lock.json"],
  ["tools/agentic-install/runtime.gitignore", ".github/wikikb/.gitignore"],
  ["tools/wikikb-local/install.sh", ".github/wikikb/tools/wikikb-local/install.sh"],
  ["tools/wikikb-local/wkb", ".github/wikikb/tools/wikikb-local/wkb"],
  ["tools/wikikb-local/assets", ".github/wikikb/tools/wikikb-local/assets"],
  ["tools/wikikb-local/src", ".github/wikikb/tools/wikikb-local/src"],
  ["tools/wikikb-local/tsconfig.json", ".github/wikikb/tools/wikikb-local/tsconfig.json"],
  ["vendor/lexcat", ".github/wikikb/vendor/lexcat"],
  ["LICENSE", ".github/wikikb/LICENSE"],
];

function collect(source, destination, files) {
  const metadata = fs.lstatSync(source);
  if (metadata.isSymbolicLink()) throw new Error(`Refusing to install symlink: ${source}`);
  if (metadata.isDirectory()) {
    for (const entry of fs.readdirSync(source).sort()) {
      collect(path.join(source, entry), path.join(destination, entry), files);
    }
    return;
  }
  if (!metadata.isFile()) throw new Error(`Unsupported installer source: ${source}`);
  files.push({ source, destination, mode: metadata.mode & 0o777 });
}

function assertSafeDestination(destination) {
  const relative = path.relative(targetRoot, destination);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Unsafe installer destination: ${destination}`);
  }
  let current = destination;
  while (current !== targetRoot) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to write through target symlink: ${current}`);
    }
    current = path.dirname(current);
  }
}

function transformedBody(file) {
  let body = fs.readFileSync(file.source);
  const relative = path.relative(targetRoot, file.destination).split(path.sep).join("/");
  if (defaultBranch !== "main" && relative === ".github/workflows/sync-labels.yml") {
    const text = body.toString("utf8").replace("branches: [main]", `branches: [${JSON.stringify(defaultBranch)}]`);
    body = Buffer.from(text, "utf8");
  }
  return body;
}

const files = [];
for (const [source, destination] of mappings) {
  const sourceBase = source.startsWith(".github/") ? templateRoot : sourceRoot;
  collect(path.join(sourceBase, source), path.join(targetRoot, destination), files);
}
for (const file of files) assertSafeDestination(file.destination);

const planned = files.map((file) => ({ ...file, body: transformedBody(file) }));
const conflicts = planned.filter((file) => fs.existsSync(file.destination) && !fs.readFileSync(file.destination).equals(file.body));
if (conflicts.length && !force) {
  const listed = conflicts.map((file) => `  ${path.relative(targetRoot, file.destination)}`).join("\n");
  throw new Error(`Refusing to overwrite ${conflicts.length} changed file(s). Review them, then rerun with --force:\n${listed}`);
}

let written = 0;
let unchanged = 0;
let repairedModes = 0;
for (const file of planned) {
  if (fs.existsSync(file.destination) && fs.readFileSync(file.destination).equals(file.body)) {
    if ((fs.statSync(file.destination).mode & 0o777) !== file.mode) {
      fs.chmodSync(file.destination, file.mode);
      repairedModes += 1;
      continue;
    }
    unchanged += 1;
    continue;
  }
  fs.mkdirSync(path.dirname(file.destination), { recursive: true });
  const temporary = `${file.destination}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, file.body, { mode: file.mode });
    fs.chmodSync(temporary, file.mode);
    fs.renameSync(temporary, file.destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  written += 1;
}

console.log(`WikiKB files installed in ${targetRoot}`);
console.log(`Written: ${written}; unchanged: ${unchanged}; modes repaired: ${repairedModes}`);
console.log("Next: enable and initialize the wiki, compile workflows with gh aw, install the local CLI, and verify the target.");
