/**
 * Renders every email of the document catalog to static HTML, for a quick
 * diff or a review outside the browser. The interactive gallery lives at
 * /dev/documents (emails and PDFs) when the dev server is running.
 *
 *   pnpm --filter @louez/web exec tsx scripts/preview-emails.ts [locale]
 *
 * Output: apps/web/.email-previews/<store>/<document>.html (gitignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  DOCUMENT_PREVIEW_STORES,
  EMAIL_PREVIEW_LOCALES,
} from "../lib/document-previews/document-previews.fixtures";
import { EMAIL_DOCUMENT_PREVIEWS } from "../lib/document-previews/email-document-previews";
import { renderDocumentPreview } from "../lib/document-previews/util.render-document-preview";
import type { EmailLocale } from "../lib/email/i18n";

const requestedLocale = process.argv[2] ?? "fr";
const isEmailLocale = (value: string): value is EmailLocale =>
  EMAIL_PREVIEW_LOCALES.some((locale) => locale === value);

async function main() {
  if (!isEmailLocale(requestedLocale)) {
    throw new Error(
      `Unknown locale "${requestedLocale}" (expected ${EMAIL_PREVIEW_LOCALES.join(", ")})`,
    );
  }

  // The auth emails live in `@louez/email`, outside this app's tsconfig: tsx
  // compiles them with the classic JSX runtime and they throw. The /dev/documents
  // gallery renders them fine through Next.
  const documents = EMAIL_DOCUMENT_PREVIEWS.filter(
    (document) => document.group !== "platform-email",
  );

  for (const store of DOCUMENT_PREVIEW_STORES) {
    // Run from apps/web (pnpm --filter @louez/web exec tsx scripts/preview-emails.ts)
    const outDir = join(process.cwd(), ".email-previews", store.id);
    mkdirSync(outDir, { recursive: true });

    for (const document of documents) {
      const rendered = await renderDocumentPreview(document, { store, locale: requestedLocale });
      writeFileSync(join(outDir, `${document.id}.html`), rendered.body);
    }

    console.log(`${store.id}: ${documents.length} emails → ${outDir}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
