import assert from "node:assert/strict";
import { test } from "node:test";
import { Font } from "@react-pdf/renderer";
import { getPdfFonts } from "./fonts";

const samples = {
  zh: "设备租赁合同 北京市朝阳区 押金 € ¥",
  ja: "機材レンタル契約書 東京都渋谷区 保証金 € ¥",
  pl: "Zażółć gęślą jaźń Łukasz ąęłńóśźż €",
  ru: "Договор аренды Москва Залог ₽ €",
  ko: "장비 대여 계약서 서울특별시 종로구 보증금 ₩ €",
} as const;

for (const locale of ["zh", "ja", "ru", "ko", "pl"] as const) {
  test(`${locale}: bundled PDF fonts cover labels and customer-entered names`, async () => {
    const fonts = getPdfFonts(locale);
    for (const descriptor of [
      { fontFamily: fonts.regular, fontWeight: 400 },
      { fontFamily: fonts.bold, fontWeight: 700 },
    ]) {
      await Font.load(descriptor);
      const font = Font.getFont(descriptor).data;
      assert.ok(font);
      for (const character of samples[locale]) {
        const codePoint = character.codePointAt(0);
        assert.ok(codePoint !== undefined);
        assert.ok(font.hasGlyphForCodePoint(codePoint), `${locale}: missing ${character}`);
      }
    }
  });
}


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

test("every PDF embeds a local font with Latin or CJK coverage instead of Helvetica", async () => {
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
      assert.match(source, /\/BaseFont \/[A-Z]{6}\+(Inter|NotoSansCJK)/, `${document.id} (${locale})`);
      assert.doesNotMatch(source, /\/BaseFont \/Helvetica/, `${document.id} (${locale})`);
    }
  }
});
