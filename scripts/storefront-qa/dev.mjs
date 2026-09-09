import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appEnv, readState, snapshotDir, stateDir } from "./runtime.mjs";
import { createFixtureServer } from "./fixtures.mjs";

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
const server = createFixtureServer(state, stateDir);
server.on("error", (error) => {
  console.error(error.message);
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
  console.log("Recette: https://louez-qa.localify/qa/index.html");
  let stopping = false;
  const cleanup = () => {
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
