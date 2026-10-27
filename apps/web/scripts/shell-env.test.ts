import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// keepShellEnv runs in a process of its own: it moves the process into a new directory.

const localRequire = createRequire(import.meta.url);
const TSX_LOADER = pathToFileURL(localRequire.resolve("tsx")).href;
const DOTENV = pathToFileURL(localRequire.resolve("dotenv")).href;
const SHELL_ENV = new URL("./shell-env.ts", import.meta.url);

/** Calls keepShellEnv, then loads .env files as migrate.ts does, and reports. */
const PROBE = `import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import dotenv from ${JSON.stringify(DOTENV)};
// apps/web is CommonJS: its default export is module.exports.
import shellEnv from ${JSON.stringify(SHELL_ENV.href)};

const { keepShellEnv } = shellEnv;

const startedIn = process.cwd();
const shell = keepShellEnv({ PRESET: "set", REMOVED: undefined });
const cwd = process.cwd();
const report = {
  moved: cwd !== startedIn,
  newTempDirectory: dirname(cwd) === tmpdir() && basename(cwd).startsWith("louez-script-"),
  files: readdirSync("."),
  preset: process.env.PRESET,
  removed: !("REMOVED" in process.env),
  unchanged: shell.changes(),
};
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
report.sentinel = process.env.SENTINEL ?? null;
process.env.ADDED = "1";
process.env.PRESET = "changed";
delete process.env.KEPT;
report.changed = shell.changes();
console.log(JSON.stringify(report));
`;

test("a script keeps its shell's variables: no .env file is found, and changes are listed", () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "louez-shell-env-")));
  try {
    // The directory the script starts in holds a .env, as apps/web may.
    writeFileSync(join(parent, ".env"), "SENTINEL=from-the-env-file\n");
    writeFileSync(join(parent, "probe.mjs"), PROBE);
    const temp = join(parent, "tmp");
    mkdirSync(temp);

    const result = spawnSync(process.execPath, ["--import", TSX_LOADER, "probe.mjs"], {
      cwd: parent,
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        TMPDIR: temp,
        REMOVED: "x",
        KEPT: "y",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null"), {
      moved: true,
      newTempDirectory: true,
      files: [],
      preset: "set",
      removed: true,
      unchanged: [],
      sentinel: null,
      changed: ["ADDED", "KEPT", "PRESET"],
    });
    // The directory is removed on exit.
    assert.deepEqual(
      readdirSync(temp).filter((name) => name.startsWith("louez-script-")),
      [],
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("it imports only Node built-ins, so a script can call it before any module of the app", async () => {
  const source = await readFile(fileURLToPath(SHELL_ENV), "utf8");
  const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1] ?? "");
  assert.ok(imports.length > 0);
  for (const name of imports) assert.match(name, /^node:/);
});
