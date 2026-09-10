import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cleanEnv, run, snapshotDir, sourceRoot, stateDir } from "./runtime.mjs";
import { patchedFiles, transformSource } from "./source-transforms.mjs";

function persist(state) {
  writeFileSync(path.join(stateDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function syncSources(state, ownerPid) {
  if (
    existsSync(path.join(stateDir, "running.json")) &&
    JSON.parse(readFileSync(path.join(stateDir, "running.json"), "utf8")).pid !== ownerPid
  )
    throw new Error("Stop qa:storefront dev before setup/sync/reset.");
  mkdirSync(snapshotDir, { recursive: true });
  run("rsync", [
    "-a",
    "--delete",
    "--exclude=.git",
    "--exclude=node_modules",
    "--exclude=.next",
    "--exclude=.turbo",
    "--exclude=.agent-docs",
    "--exclude=.env*",
    "--exclude=*.tsbuildinfo",
    "--exclude=.localify*",
    "--exclude=.playwright-cli",
    "--exclude=output",
    "--exclude=/apps/web/public/qa",
    `${sourceRoot}/`,
    `${snapshotDir}/`,
  ]);
  for (const file of patchedFiles) {
    const target = path.join(snapshotDir, file);
    writeFileSync(target, transformSource(file, readFileSync(path.join(sourceRoot, file)), state));
  }
  run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts", "--offline"], {
    cwd: snapshotDir,
    env: { ...cleanEnv(), CI: "true" },
  });
  if (existsSync(path.join(stateDir, "report.html"))) {
    mkdirSync(path.join(snapshotDir, "apps/web/public/qa"), { recursive: true });
    writeFileSync(
      path.join(snapshotDir, "apps/web/public/qa/index.html"),
      readFileSync(path.join(stateDir, "report.html")),
    );
    writeFileSync(
      path.join(snapshotDir, "apps/web/public/qa/reset.html"),
      '<!doctype html><meta charset="utf-8"><script>localStorage.clear();sessionStorage.clear();location.replace("/")</script>',
    );
  }
  state.snapshotAt = new Date().toISOString();
  state.revision = run("git", ["rev-parse", "HEAD"], { stdio: "pipe" });
  state.dirtyFiles = run("git", ["status", "--porcelain"], { stdio: "pipe" })
    .split("\n")
    .filter(Boolean).length;
  persist(state);
  if (existsSync(path.join(stateDir, "manifest.json"))) {
    run("pnpm", ["exec", "tsx", "scripts/storefront-qa/refresh-report.ts", stateDir], {
      cwd: path.join(snapshotDir, "apps/web"),
      env: cleanEnv(),
    });
  }
}
