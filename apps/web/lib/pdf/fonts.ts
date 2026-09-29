import { resolve } from "node:path";
import { Font } from "@react-pdf/renderer";

import type { Locale } from "@/i18n/config";

// Bundled fonts keep PDF generation offline, including user-entered names and
// product descriptions. Keep complete character sets, not just translated UI text.
const fontPath = (file: string) => resolve(process.cwd(), "public/fonts/pdf", file);

for (const locale of ["zh", "ja", "ko"] as const) {
  Font.register({
    family: `LouezCJK-${locale}`,
    src: fontPath(`NotoSansCJK-${locale}.woff`),
  });
}
Font.register({
  family: "LouezInter",
  fonts: [
    { src: fontPath("Inter-Regular.woff"), fontWeight: 400 },
    { src: fontPath("Inter-Bold.woff"), fontWeight: 700 },
  ],
});

export const getPdfFonts = (locale: Locale) => {
  if (locale === "zh" || locale === "ja" || locale === "ko") {
    const family = `LouezCJK-${locale}`;
    return { regular: family, bold: family };
  }
  if (locale === "ru") return { regular: "LouezInter", bold: "LouezInter" };
  return { regular: "Helvetica", bold: "Helvetica-Bold" };
};
