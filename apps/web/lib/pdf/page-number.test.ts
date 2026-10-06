import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";
import { renderToBuffer } from "@react-pdf/renderer";
import fr from "@/messages/fr.json";
import inspectionFr from "@/messages/inspections/fr.json";

const fixtureDirectory = mkdtempSync(join(tmpdir(), "louez-page-number-test-"));
const fixturePath = join(fixtureDirectory, "env.cjs");
writeFileSync(
  fixturePath,
  "exports.env = { NEXT_PUBLIC_APP_URL: 'https://example.invalid', NEXT_PUBLIC_APP_DOMAIN: 'example.invalid' };",
);
after(() => rmSync(fixtureDirectory, { recursive: true }));
const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function")
  throw new Error("This test requires Node.js registerHooks");
registerHooks({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    nextResolve: (
      specifier: string,
      context: { parentURL?: string },
    ) => { url: string; shortCircuit?: boolean },
  ) {
    if (specifier === "@/env" || specifier.endsWith("/apps/web/env.ts"))
      return { shortCircuit: true, url: pathToFileURL(fixturePath).href };
    return specifier === "server-only"
      ? { shortCircuit: true, url: "node:module" }
      : nextResolve(specifier, context);
  },
});

// PDFKit writes page dictionaries outside compressed content streams.
const countPages = (pdf: Buffer) =>
  Array.from(pdf.toString("latin1").matchAll(/\/Type\s*\/Page\b/g)).length;

const paragraph =
  "Le locataire s'engage à restituer le matériel dans l'état où il l'a reçu, à la date convenue. ";
const date = new Date("2026-09-08T09:00:00Z");

// The page number's line height used to grow on every page: PDFKit refused the twelfth.
test("a contract whose terms run past eleven pages renders", async () => {
  const { ContractDocument } = await import("./contract");
  const pdf = await renderToBuffer(
    ContractDocument({
      store: { slug: "test", name: "Test location" },
      reservation: {
        number: "TEST",
        startDate: date,
        endDate: date,
        createdAt: date,
        subtotalAmount: "20",
        totalAmount: "20",
        depositAmount: "0",
        customer: { firstName: "Test", lastName: "Client", email: "test@example.invalid" },
        items: [],
        payments: [],
      },
      document: { number: "TEST", generatedAt: date },
      translations: fr.contract,
      locale: "fr",
      timezone: "Europe/Paris",
      fullCgvHtml: `<p>${paragraph.repeat(4)}</p>`.repeat(260),
    }),
  );
  assert.ok(countPages(pdf) > 11, `${countPages(pdf)} pages`);
});

test("an inspection report that runs past eleven pages renders", async () => {
  const { InspectionReportDocument } = await import("./inspection-report");
  const pdf = await renderToBuffer(
    InspectionReportDocument({
      store: { name: "Test location" },
      inspection: {
        id: "test",
        type: "departure",
        status: "completed",
        reservationNumber: "TEST",
        customerName: "Test Client",
        hasDamage: false,
        createdAt: date,
        items: Array.from({ length: 120 }, (_, index) => ({
          productName: `Article ${index + 1}`,
          condition: "good" as const,
          notes: paragraph.repeat(4),
          photos: [],
        })),
      },
      document: { number: "TEST", generatedAt: date },
      translations: inspectionFr,
      locale: "fr",
      timezone: "Europe/Paris",
    }),
  );
  assert.ok(countPages(pdf) > 11, `${countPages(pdf)} pages`);
});
