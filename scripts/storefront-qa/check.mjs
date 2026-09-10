import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { domain, readState, stateDir } from "./runtime.mjs";

const state = readState();
const manifest = JSON.parse(readFileSync(path.join(stateDir, "manifest.json"), "utf8"));
const checks = [
  { url: `https://${domain}/qa/index.html`, expected: "Recette du storefront" },
  ...manifest.stores.map((store) => ({ url: store.url, expected: store.name })),
  { url: `http://127.0.0.1:${state.fixturePort}`, expected: "Simulateur local Louez" },
  { url: `http://127.0.0.1:${state.mailPort}/api/v1/messages`, expected: '"messages"' },
];
const results = [];
for (const check of checks) {
  // curl uses the Localify CA trusted by the host, without disabling TLS verification.
  const response = spawnSync(
    "curl",
    ["--silent", "--show-error", "--fail", "--max-time", "45", check.url],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  const passed = response.status === 0 && response.stdout.includes(check.expected);
  results.push({
    url: check.url,
    passed,
    ...(passed ? {} : { error: response.stderr.trim() || "Expected content missing" }),
  });
  console.log(`${passed ? "PASS" : "FAIL"} ${check.url}`);
}
writeFileSync(
  path.join(stateDir, "http-checks.json"),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      snapshotAt: state.snapshotAt,
      scope: "HTTP and expected content only; no business flow validation",
      results,
    },
    null,
    2,
  ),
);
console.log(
  `${results.filter((result) => result.passed).length}/${results.length} HTTP checks passed. This does not validate the reservation flows.`,
);
if (results.some((result) => !result.passed)) process.exitCode = 1;
