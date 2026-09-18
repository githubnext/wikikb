#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const checkOnly = process.argv.includes("--check");
const bundleName = `wikikb-v${packageJson.version}-cli-agentic-workflows`;
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wikikb-release-"));
const stagingRoot = path.join(temporaryRoot, bundleName);
const outputRoot = checkOnly ? path.join(temporaryRoot, "output") : path.join(repoRoot, "release");
const archivePath = path.join(outputRoot, `${bundleName}.tar.gz`);
const reproducibilityPath = path.join(outputRoot, `${bundleName}.reproducibility.tar.gz`);
const releaseTimestamp = new Date("2000-01-01T00:00:00.000Z");

const releasePaths = [
  ".gitattributes",
  ".github/actionlint.yaml",
  ".github/workflows",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "INSTALL.md",
  "LICENSE",
  "README.md",
  "SKILL.md",
  "docs",
  "package-lock.json",
  "package.json",
  "tests/integration/.env.example",
  "tests/integration/README.md",
  "tools/kb-search.sh",
  "tools/agentic-install",
  "tools/install-agentic.js",
  "tools/package-release.js",
  "tools/validate-release.js",
  "tools/validate-wiki.js",
  "tools/wikikb-local/install.sh",
  "tools/wikikb-local/assets",
  "tools/wikikb-local/src",
  "tools/wikikb-local/test/integration.mjs",
  "tools/wikikb-local/test/release.mjs",
  "tools/wikikb-local/test/smoke.mjs",
  "tools/wikikb-local/tsconfig.json",
  "tools/wikikb-local/wkb",
  "gh-wikikb",
  "vendor/lexcat",
  "wiki-mirror",
];

const excludedSegments = new Set(["node_modules", "dist", "release"]);

function copyFilter(sourcePath) {
  const relativePath = path.relative(repoRoot, sourcePath);
  if (!relativePath) return true;
  const segments = relativePath.split(path.sep);
  if (segments.some((segment) => excludedSegments.has(segment))) return false;
  if (segments.at(-1) === ".env" || segments.at(-1) === ".DS_Store") return false;
  return !relativePath.startsWith(`extensions${path.sep}`);
}

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function normalizeReleaseTree(root) {
  const visit = (current) => {
    const metadata = fs.lstatSync(current);
    if (metadata.isSymbolicLink()) throw new Error(`Release bundle cannot contain symlinks: ${path.relative(root, current)}`);
    if (metadata.isDirectory()) {
      for (const entry of fs.readdirSync(current).sort()) visit(path.join(current, entry));
    }
    fs.utimesSync(current, releaseTimestamp, releaseTimestamp);
  };
  visit(root);
}

function createArchive(destination) {
  const version = run("tar", ["--version"]);
  const common = ["--format=ustar", "--numeric-owner"];
  const ownership = /GNU tar/i.test(version)
    ? ["--sort=name", "--mtime=@946684800", "--owner=0", "--group=0"]
    : ["--uid=0", "--gid=0", "--uname=root", "--gname=root"];
  const uncompressed = `${destination}.${process.pid}.tar`;
  try {
    run("tar", [...common, ...ownership, "-cf", uncompressed, "-C", temporaryRoot, bundleName]);
    const output = fs.openSync(destination, "w", 0o644);
    try {
      const compressed = spawnSync("gzip", ["-n", "-c", uncompressed], {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env },
        stdio: ["ignore", output, "pipe"],
      });
      if (compressed.status !== 0) throw new Error(`gzip failed: ${(compressed.stderr || "").trim()}`);
    } finally {
      fs.closeSync(output);
    }
  } finally {
    fs.rmSync(uncompressed, { force: true });
  }
}

try {
  fs.mkdirSync(stagingRoot, { recursive: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  for (const relativePath of releasePaths) {
    const sourcePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(sourcePath)) throw new Error(`Missing release path: ${relativePath}`);
    const destinationPath = path.join(stagingRoot, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.cpSync(sourcePath, destinationPath, { recursive: true, filter: copyFilter });
  }

  const stagedValidation = run(process.execPath, ["tools/validate-release.js"], stagingRoot);
  if (!/Errors: 0/.test(stagedValidation)) throw new Error("Staged release validation did not report success.");

  normalizeReleaseTree(stagingRoot);
  createArchive(archivePath);
  if (checkOnly) {
    createArchive(reproducibilityPath);
    const first = crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
    const second = crypto.createHash("sha256").update(fs.readFileSync(reproducibilityPath)).digest("hex");
    if (first !== second) throw new Error("Release archive is not byte-reproducible from a normalized staging tree.");
  }
  const entries = run("tar", ["-tzf", archivePath]).trim().split("\n").filter(Boolean);
  const retiredProjectTerms = [
    ["ray", "cast"].join(""),
    ["chro", "me"].join(""),
  ];
  const forbidden = entries.filter((entry) =>
    entry.includes("/extensions/")
      || entry.includes("/node_modules/")
      || entry.includes("/dist/")
      || retiredProjectTerms.some((term) => entry.toLowerCase().includes(term))
      || /\/(?:\.env|\.DS_Store)$/.test(entry),
  );
  if (forbidden.length) throw new Error(`Forbidden release entries:\n${forbidden.join("\n")}`);

  const expected = [
    `${bundleName}/INSTALL.md`,
    `${bundleName}/.github/actionlint.yaml`,
    `${bundleName}/docs/release-scope.md`,
    `${bundleName}/tools/install-agentic.js`,
    `${bundleName}/tools/agentic-install/runtime-package-lock.json`,
    `${bundleName}/tools/wikikb-local/src/main.ts`,
    `${bundleName}/tools/wikikb-local/assets/wikikb-memory/SKILL.md`,
    `${bundleName}/gh-wikikb`,
    `${bundleName}/vendor/lexcat/manifest.json`,
    `${bundleName}/vendor/lexcat/THIRD_PARTY_NOTICES.txt`,
    `${bundleName}/vendor/lexcat/lexcat-v0.0.20-macos-arm64.tar.gz`,
    `${bundleName}/vendor/lexcat/lexcat-v0.0.20-macos-x86_64.tar.gz`,
    `${bundleName}/vendor/lexcat/lexcat-v0.0.20-linux-arm64.tar.gz`,
    `${bundleName}/vendor/lexcat/lexcat-v0.0.20-linux-x86_64.tar.gz`,
    `${bundleName}/vendor/lexcat/lexcat-v0.0.20-windows-x86_64.zip`,
    `${bundleName}/tools/agentic-install/template/.github/workflows/compile-kb.md`,
    `${bundleName}/tools/agentic-install/template/.github/workflows/compile-kb.lock.yml`,
    `${bundleName}/tools/agentic-install/template/.github/aw/actions-lock.json`,
  ];
  for (const entry of expected) {
    if (!entries.includes(entry)) throw new Error(`Release bundle is missing ${entry}`);
  }

  const digest = crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
  const checksumPath = `${archivePath}.sha256`;
  fs.writeFileSync(checksumPath, `${digest}  ${path.basename(archivePath)}\n`);

  console.log(`Release bundle verified: ${entries.length} entries`);
  console.log(checkOnly ? "Reproducible archive: verified" : "Deterministic archive metadata: normalized");
  console.log("Supported surfaces: CLI, Agentic Workflows");
  console.log("Extension paths: 0");
  if (!checkOnly) {
    console.log(`Archive: ${path.relative(repoRoot, archivePath)}`);
    console.log(`Checksum: ${path.relative(repoRoot, checksumPath)}`);
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
