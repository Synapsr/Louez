// Keeps an ops script to the environment its shell gave it. Importing @louez/db loads
// `.env.local` and `.env` from the cwd (packages/db/src/migrate.ts), and pnpm runs a
// package's script from its directory: apps/web, where a developer's .env may hold a
// Stripe key and LOUEZ_BILLING. Node built-ins only, so a script can call it before it
// imports any module of the app.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ShellEnv {
  /** The variables added, changed or removed since `keepShellEnv`, sorted. */
  changes(): string[];
}

/**
 * Sets `preset` (undefined removes a variable), moves the process into a new empty
 * directory, removed on exit, so no dotenv call finds a file there, and records the
 * environment. Call it before importing any module of the app, and stop if `changes()`
 * lists anything once the last one is imported.
 */
export function keepShellEnv(preset: Readonly<Record<string, string | undefined>>): ShellEnv {
  for (const [name, value] of Object.entries(preset)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  const directory = mkdtempSync(join(tmpdir(), "louez-script-"));
  process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
  process.chdir(directory);

  const recorded: Readonly<Record<string, string | undefined>> = { ...process.env };
  return {
    changes: () =>
      [...new Set([...Object.keys(recorded), ...Object.keys(process.env)])]
        .filter((name) => recorded[name] !== process.env[name])
        .sort(),
  };
}
