import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from "node:fs";
import path from "node:path";
import { renderReport } from "./report";

const output = process.argv[2];
if (!output) throw new Error("Missing QA state directory");
const manifest = JSON.parse(readFileSync(path.join(output, "manifest.json"), "utf8"));
const state = JSON.parse(readFileSync(path.join(output, "state.json"), "utf8"));
const report = {
  ...manifest,
  snapshotAt: state.snapshotAt,
  revision: state.revision,
  dirtyFiles: state.dirtyFiles,
  mailUrl: `http://127.0.0.1:${state.mailPort}`,
  fixtureUrl: `http://127.0.0.1:${state.fixturePort}`,
  verificationUrl: existsSync(path.join(output, "evidence/verification.html"))
    ? "/qa/evidence/verification.html"
    : undefined,
};
mkdirSync("public/qa", { recursive: true });
if (report.verificationUrl)
  cpSync(path.join(output, "evidence"), "public/qa/evidence", { recursive: true });
writeFileSync("public/qa/index.html", renderReport(report));
writeFileSync(path.join(output, "report.html"), renderReport(report));
writeFileSync(path.join(output, "manifest.json"), JSON.stringify(report, null, 2));
