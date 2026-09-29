import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";

import type { Locale } from "@/i18n/config";

// The app's TypeScript modules are CommonJS under tsx; this .mts entrypoint is ESM.
// Fixture generation must never require production credentials. The app env
// module recognizes "true" (rather than the CLI's conventional "1").
process.env.SKIP_ENV_VALIDATION = "true";
// Next supplies this marker when bundling. Standalone Node is already a server.
const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function")
  throw new Error("Use Node.js 22.15+ to generate demo PDFs");
registerHooks({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    nextResolve: (specifier: string, context: { parentURL?: string }) => { url: string },
  ) {
    return specifier === "server-only"
      ? { shortCircuit: true, url: "node:module" }
      : nextResolve(specifier, context);
  },
});
const require = createRequire(import.meta.url);
const { locales }: typeof import("@/i18n/config") = require("@/i18n/config");
const {
  createDemoContractProps,
  createDemoContractSnapshot,
}: typeof import("@/lib/landing-demos/contracts") = require("@/lib/landing-demos/contracts");
const { ContractDocument }: typeof import("@/lib/pdf/contract") = require("@/lib/pdf/contract");
// The same react-pdf instance as the app modules: the fonts they register live in it.
const { renderToBuffer }: typeof import("@react-pdf/renderer") = require("@react-pdf/renderer");
const { getContractTranslations }: typeof import("@/lib/pdf/contract-i18n") = require("@/lib/pdf/contract-i18n");
const sharp: typeof import("sharp") = require("sharp");

// `pnpm --filter @louez/web demo:documents`. The Docker build runs it before `next build`: the
// scenes import the date snapshot, so the images and the bundle carry the same dates.
// Do not import generate.ts: its production path uses the database and validates reservations.
// ContractDocument embeds Inter (lib/pdf/fonts.ts) and no remote logo here.
const pdfDirectory = new URL("../.demo-documents/", import.meta.url);
const assetDirectory = new URL("../public/demo-documents/", import.meta.url);
await mkdir(pdfDirectory, { recursive: true });
await mkdir(assetDirectory, { recursive: true });

/** Page images as wide as the demo shows them. */
const PAGE_WIDTH = 1240;

const hasCommand = (command: string) => !spawnSync(command, ["-v"], { stdio: "ignore" }).error;

// poppler's pdftoppm where it exists (the Docker build installs it), macOS PDFKit otherwise.
const renderPages = async (pdf: string): Promise<string[]> => {
  const directory = await mkdtemp(join(tmpdir(), "louez-contract-"));
  const run = hasCommand("pdftoppm")
    ? spawnSync("pdftoppm", [
        "-png",
        "-scale-to-x",
        String(PAGE_WIDTH),
        "-scale-to-y",
        "-1",
        pdf,
        join(directory, "page"),
      ])
    : process.platform === "darwin"
      ? spawnSync("swift", [
          fileURLToPath(new URL("./pdf-pages.swift", import.meta.url)),
          pdf,
          directory,
          String(PAGE_WIDTH),
        ])
      : null;
  if (!run) throw new Error("Install poppler (pdftoppm) to render the contract pages.");
  if (run.status !== 0) throw new Error(`Rendering ${pdf} failed: ${run.stderr?.toString() ?? ""}`);
  // pdftoppm pads page numbers (page-01.png) past nine pages; PDFKit writes page-1.png.
  const pages = (await readdir(directory))
    .filter((name) => /^page-\d+\.png$/.test(name))
    .sort((left, right) => Number(left.replace(/\D/g, "")) - Number(right.replace(/\D/g, "")));
  return pages.map((name) => join(directory, name));
};

const snapshot = createDemoContractSnapshot();
const counts: Partial<Record<Locale, number>> = {};
for (const locale of locales) {
  const buffer = await renderToBuffer(
    ContractDocument(createDemoContractProps(locale, snapshot, getContractTranslations(locale))),
  );
  // PDFKit writes page dictionaries outside compressed content streams. Count
  // actual /Page objects, excluding the /Pages tree, instead of assuming a layout.
  const pageCount = Array.from(buffer.toString("latin1").matchAll(/\/Type\s*\/Page\b/g)).length;
  if (pageCount === 0) throw new Error(`No pages rendered for contract.${locale}.pdf`);
  const destination = new URL(`contract.${locale}.pdf`, pdfDirectory);
  await writeFile(destination, buffer);
  const pages = await renderPages(fileURLToPath(destination));
  if (pages.length !== pageCount)
    throw new Error(`contract.${locale}.pdf: ${pageCount} pages, ${pages.length} images`);
  for (const stale of await readdir(assetDirectory)) {
    if (stale.startsWith(`contract.${locale}.p`)) await rm(new URL(stale, assetDirectory));
  }
  for (const [index, page] of pages.entries()) {
    await sharp(page)
      .webp({ quality: 82 })
      .toFile(fileURLToPath(new URL(`contract.${locale}.p${index + 1}.webp`, assetDirectory)));
  }
  await rm(join(pages[0], ".."), { recursive: true, force: true });
  counts[locale] = pageCount;
  process.stdout.write(`${fileURLToPath(destination)}: ${pageCount} pages\n`);
}
await writeFile(
  new URL("manifest.json", assetDirectory),
  `${JSON.stringify({ contract: counts }, null, 2)}\n`,
);
await writeFile(
  new URL("reservation.json", assetDirectory),
  `${JSON.stringify(snapshot, null, 2)}\n`,
);
