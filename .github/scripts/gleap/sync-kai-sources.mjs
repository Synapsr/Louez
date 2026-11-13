/**
 * Keeps Kai (Gleap's support AI) reading the same public sources as the
 * agents: the READMEs, the changelog and louez.io/llms-full.txt. Each source
 * is one AI content entry, upserted by a stable contentId, so a run replaces
 * the previous text instead of adding a copy.
 *
 *   DRY_RUN=false GLEAP_API_KEY=… GLEAP_PROJECT_ID=… GLEAP_AI_CONTENT_TYPE=… \
 *     node .github/scripts/gleap/sync-kai-sources.mjs
 *
 * GLEAP_AI_CONTENT_TYPE has no default on purpose: read the `type` of an entry
 * created in the dashboard (GET /aicontent/{contentId}) and use the same value.
 */
import { readFile } from "node:fs/promises";

import { dryRun, gleap, requireEnv } from "./client.mjs";

const REPO = "https://github.com/Synapsr/Louez/blob/main";
const BATCH = "louez-public-sources";

const SOURCES = [
  {
    contentId: "louez-readme-en",
    title: "Louez README (English)",
    file: "README.md",
    url: `${REPO}/README.md`,
  },
  {
    contentId: "louez-readme-fr",
    title: "Louez README (français)",
    file: "README.fr.md",
    url: `${REPO}/README.fr.md`,
  },
  {
    contentId: "louez-changelog",
    title: "Louez changelog",
    file: "CHANGELOG.md",
    url: `${REPO}/CHANGELOG.md`,
  },
  {
    contentId: "louez-llms-full",
    title: "Louez.io: full product reference (llms-full.txt)",
    remote: "https://louez.io/llms-full.txt",
    url: "https://louez.io/llms-full.txt",
  },
];

async function load(source) {
  if (source.file) return readFile(source.file, "utf8");
  const response = await fetch(source.remote);
  if (!response.ok) throw new Error(`${source.remote} answered ${response.status}`);
  return response.text();
}

const type = dryRun
  ? (process.env.GLEAP_AI_CONTENT_TYPE ?? "<GLEAP_AI_CONTENT_TYPE>")
  : requireEnv("GLEAP_AI_CONTENT_TYPE");

for (const source of SOURCES) {
  const content = await load(source);
  await gleap("PUT", `/aicontent/${encodeURIComponent(source.contentId)}`, {
    title: source.title,
    content,
    type,
    batchId: BATCH,
    readMoreUrl: source.url,
    readMoreLabel: source.file ? "GitHub" : "louez.io",
  });
  console.log(
    `${dryRun ? "would sync" : "synced"} ${source.contentId} (${content.length} characters)`,
  );
}
