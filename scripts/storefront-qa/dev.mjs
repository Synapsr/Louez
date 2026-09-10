import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appEnv, readState, snapshotDir, sourceRoot, stateDir } from "./runtime.mjs";
import { createFixtureServer } from "./fixtures.mjs";
import { syncSources } from "./sync.mjs";
import { createSourceMirror } from "./source-mirror.mjs";

const state = readState();
const lock = path.join(stateDir, "running.json");
if (existsSync(lock)) {
  const previous = JSON.parse(readFileSync(lock, "utf8"));
  try {
    process.kill(previous.pid, 0);
    throw new Error(`QA already running (PID ${previous.pid})`);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
    rmSync(lock);
  }
}
writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), {
  flag: "wx",
});
let mirror;
try {
  console.log("Actualisation des sources de recette…");
  syncSources(state, process.pid);
  mirror = createSourceMirror({
    sourceRoot,
    snapshotDir,
    state,
    onChange(files) {
      console.log(`[QA sources] ${files.length} fichier(s) synchronisé(s).`);
      if (
        files.some((file) =>
          /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/.test(file),
        )
      ) {
        console.log(
          "[QA sources] Dépendances modifiées : relancer qa:storefront dev pour les installer.",
        );
      }
    },
    onError(error) {
      console.error(`[QA sources] ${error.message}`);
    },
  });
  mirror.start();
} catch (error) {
  rmSync(lock, { force: true });
  throw error;
}
const server = createFixtureServer(state, stateDir);
server.on("error", (error) => {
  console.error(error.message);
  mirror.close();
  rmSync(lock, { force: true });
  process.exitCode = 1;
});
server.listen(state.fixturePort, "127.0.0.1", () => {
  const child = spawn(
    "localify",
    [
      "dev",
      state.service,
      "--project",
      "louez-storefront-qa",
      "--",
      "env",
      `AUTH_URL=${appEnv(state).AUTH_URL}`,
      "pnpm",
      "exec",
      "next",
      "dev",
      "--turbopack",
      "--hostname",
      "127.0.0.1",
    ],
    {
      cwd: path.join(snapshotDir, "apps/web"),
      env: appEnv(state),
      stdio: "inherit",
      detached: true,
    },
  );
  console.log(
    "Sources suivies en continu : modifier les fichiers du checkout courant pour le hot reload.",
  );
  console.log("Recette: https://louez-qa.localify/qa/index.html");
  let stopping = false;
  const cleanup = () => {
    mirror.close();
    server.close();
    rmSync(lock, { force: true });
  };
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      process.kill(-child.pid, signal);
    });
  child.on("error", (error) => {
    console.error(error.message);
    cleanup();
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    cleanup();
    process.exitCode = code || 0;
  });
});
