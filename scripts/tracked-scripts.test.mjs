/**
 * `pnpm test` runs every *.test.mjs file under scripts/, and .gitignore
 * ignores the root scripts/ folder except the files it lists. A test, or a
 * file a test imports, that .gitignore does not list runs on the machine that
 * wrote it and is missing from a clean checkout, so CI fails or skips the
 * guard.
 *
 * This test follows the relative imports of every test file on disk and fails
 * when git ignores one of them. In CI the ignored files are absent, so it
 * catches the mistake before the push, not after.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = path.join(ROOT, "scripts");
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;

function listTestFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : listTestFiles(full);
    return entry.name.endsWith(".test.mjs") ? [full] : [];
  });
}

/** The test files and every file they reach through relative imports. */
function collectFiles(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(RELATIVE_IMPORT)) {
      const target = path.resolve(path.dirname(file), match[1]);
      // A path that does not exist is text inside a fixture, not an import.
      if (existsSync(target) && statSync(target).isFile()) queue.push(target);
    }
  }
  return [...seen].map((file) => path.relative(ROOT, file)).sort();
}

/** The files git ignores among `files`. Tracked files never count. */
function ignoredFiles(files) {
  const result = spawnSync("git", ["check-ignore", "--stdin", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    input: files.join("\0"),
  });
  // 0: some are ignored, 1: none are, anything else: git failed.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed: ${result.stderr || result.error}`);
  }
  return result.stdout.split("\0").filter(Boolean).sort();
}

const inGitWorkTree =
  spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: ROOT,
    encoding: "utf8",
  }).stdout?.trim() === "true";

test(
  "git tracks every script test and the files it imports",
  { skip: inGitWorkTree ? false : "not a git work tree" },
  () => {
    const files = collectFiles(listTestFiles(SCRIPTS));
    assert.ok(files.includes("scripts/tracked-scripts.test.mjs"), "the walk found no test files");

    const ignored = ignoredFiles(files);
    assert.deepEqual(
      ignored,
      [],
      `.gitignore hides files that pnpm test needs. Add them after /scripts/*:\n${ignored
        .map((file) => `!/${file}`)
        .join("\n")}`,
    );
  },
);

test("the import walk reaches the helpers a test imports", () => {
  const files = collectFiles([path.join(SCRIPTS, "reservation-writes.test.mjs")]);
  assert.ok(files.includes("scripts/source-scan.mjs"));
  assert.ok(files.every((file) => existsSync(path.join(ROOT, file))));
});
