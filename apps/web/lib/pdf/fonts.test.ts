import assert from "node:assert/strict";
import { test } from "node:test";
import { Font } from "@react-pdf/renderer";
import { getPdfFonts } from "./fonts";

const samples = {
  zh: "设备租赁合同 北京市朝阳区 押金 € ¥",
  ja: "機材レンタル契約書 東京都渋谷区 保証金 € ¥",
  ru: "Договор аренды Москва Залог ₽ €",
  ko: "장비 대여 계약서 서울특별시 종로구 보증금 ₩ €",
} as const;

for (const locale of ["zh", "ja", "ru", "ko"] as const) {
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
