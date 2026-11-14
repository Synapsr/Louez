import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { ConfirmationCheck, checkConfirmation, requireConfirmation } from "./confirmation";

// A place that asks for a confirmation declares the consequences of its
// branch, or does not compile: the compiler checks this file, and each line
// marked `@ts-expect-error` must fail (an error it does not raise is one).
// `pnpm type-check` does not compile this package's tests: the test runs the
// compiler on this file itself.

/** Never called: the compiler reads it. */
export function probes(
  ask: typeof requireConfirmation,
  check: typeof checkConfirmation,
  rest: Omit<ConfirmationCheck, "consequences" | "executor">,
  untyped: any,
  online: boolean,
  tx: NonNullable<ConfirmationCheck["executor"]>,
) {
  // @ts-expect-error: no consequences
  void ask({ ...rest });
  // @ts-expect-error: an empty list
  void ask({ ...rest, consequences: [] });
  // @ts-expect-error: an empty list, through the function that does not throw
  void check({ ...rest, consequences: [] });
  // @ts-expect-error: `always` is gone
  void ask({ ...rest, always: true });
  // @ts-expect-error: not a consequence
  void ask({ ...rest, consequences: ["refund"] });
  // @ts-expect-error: an untyped object spread over the declaration could replace it
  void ask({ ...rest, consequences: ["money"], ...untyped });
  // @ts-expect-error: an untyped check
  void ask(untyped);
  // @ts-expect-error: the throwing form takes no transaction, whose rollback would lose what it records
  void ask({ ...rest, consequences: ["money"], executor: tx });

  // What compiles: one or more consequences, per branch.
  void ask({ ...rest, consequences: ["money"] });
  void check({ ...rest, consequences: ["stock_override", "customer_message"] });
  void check({ ...rest, consequences: ["money"], executor: tx });
  void ask({ ...rest, consequences: online ? ["deletion"] : ["change"] });
}

test("a confirmation without its consequences does not compile", () => {
  const self = fileURLToPath(import.meta.url);
  const typescript = dirname(createRequire(import.meta.url).resolve("typescript/package.json"));
  const folder = mkdtempSync(join(tmpdir(), "louez-confirmation-types-"));
  try {
    const config = join(folder, "tsconfig.json");
    writeFileSync(
      config,
      JSON.stringify({
        extends: join(dirname(self), "../../tsconfig.json"),
        compilerOptions: {
          noEmit: true,
          composite: false,
          declaration: false,
          declarationMap: false,
        },
        files: [self],
        include: [],
      }),
    );
    const run = spawnSync(
      process.execPath,
      [join(typescript, "bin/tsc"), "-p", config, "--listFiles", "--pretty", "false"],
      // Errors name their file relative to the working directory.
      { encoding: "utf8", cwd: dirname(self) },
    );
    const output = `${run.stdout}${run.stderr}`;
    assert.ok(output.includes(self), `the compiler read this file:\n${output.slice(0, 2_000)}`);
    const here = output
      .split("\n")
      .filter((line) => line.startsWith(`${basename(self)}(`) && /error TS/.test(line));
    assert.deepEqual(here, [], "every line marked @ts-expect-error fails, and the others compile");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
