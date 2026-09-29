import assert from "node:assert/strict";
import test from "node:test";
import * as nodeModule from "node:module";

// The document fixtures need no credentials; the app env module recognizes "true".
process.env.SKIP_ENV_VALIDATION = "true";
// The previews pull in email helpers marked `server-only`; plain Node is already a server.
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
    return specifier === "server-only"
      ? { shortCircuit: true, url: "node:module" }
      : nextResolve(specifier, context);
  },
});

test("every PDF embeds Inter instead of Helvetica, which cannot print ą, ł or ś", async () => {
  // Through the app's own renderer: the fonts are registered on the react-pdf it loads.
  const { renderDocumentPreview } =
    await import("@/lib/document-previews/util.render-document-preview");
  const { PDF_DOCUMENT_PREVIEWS } = await import("@/lib/document-previews/pdf-document-previews");
  const { DOCUMENT_PREVIEW_STORES, PDF_PREVIEW_LOCALES } =
    await import("@/lib/document-previews/document-previews.fixtures");
  for (const document of PDF_DOCUMENT_PREVIEWS) {
    for (const locale of PDF_PREVIEW_LOCALES) {
      const rendered = await renderDocumentPreview(document, {
        store: DOCUMENT_PREVIEW_STORES[0],
        locale,
      });
      assert.equal(rendered.kind, "pdf");
      const source = Buffer.from(rendered.body).toString("latin1");
      assert.match(source, /\/BaseFont \/[A-Z]{6}\+Inter/, `${document.id} (${locale})`);
      assert.doesNotMatch(source, /\/BaseFont \/Helvetica/, `${document.id} (${locale})`);
    }
  }
});
