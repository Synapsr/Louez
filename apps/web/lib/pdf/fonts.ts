import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Locale } from "@/i18n/config";
import { Font } from "@react-pdf/renderer";

/**
 * Inter 4.1 (SIL Open Font License, see public/fonts/pdf/OFL.txt), embedded in every PDF.
 * Helvetica, react-pdf's built-in font, has no glyph for letters such as ą, ę, ł or ś: Polish
 * documents, and names such as « Łukasz » anywhere, printed broken.
 *
 * `process.cwd()` is `apps/web` under `next dev` and the scripts, the monorepo root in the
 * standalone build, whose image copies `public` as is: both roots are tried.
 */
export const PDF_FONT_FAMILY = "Inter";

const FONT_DIRECTORIES = [
  join(process.cwd(), "public", "fonts", "pdf"),
  join(process.cwd(), "apps", "web", "public", "fonts", "pdf"),
];
const fontDirectory =
  FONT_DIRECTORIES.find((directory) => existsSync(join(directory, "Inter-Regular.ttf"))) ??
  FONT_DIRECTORIES[0];

Font.register({
  family: PDF_FONT_FAMILY,
  fonts: [
    { src: join(fontDirectory, "Inter-Regular.ttf"), fontWeight: 400 },
    { src: join(fontDirectory, "Inter-Bold.ttf"), fontWeight: 700 },
  ],
});

// Full CJK coverage includes merchant data and customer names, not just UI labels.
for (const locale of ["zh", "ja", "ko"] as const) {
  Font.register({
    family: `LouezCJK-${locale}`,
    src: join(fontDirectory, `NotoSansCJK-${locale}.woff`),
  });
}

export const getPdfFonts = (locale: Locale) => {
  const family = locale === "zh" || locale === "ja" || locale === "ko"
    ? `LouezCJK-${locale}`
    : PDF_FONT_FAMILY;
  return { regular: family, bold: family };
};
