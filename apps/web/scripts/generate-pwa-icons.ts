/**
 * Generates the PWA icon set, mirroring the brand mark from `public/favicon.svg`.
 * The brand color and "L" path are duplicated below (BRAND / L_PATH) rather than
 * parsed from the SVG — keep them in sync if favicon.svg ever changes.
 *
 *   public/icons/icon-192.png       192x192  purpose "any"      (circular mark)
 *   public/icons/icon-512.png       512x512  purpose "any"
 *   public/icons/maskable-192.png   192x192  purpose "maskable" (full-bleed)
 *   public/icons/maskable-512.png   512x512  purpose "maskable"
 *   public/apple-touch-icon.png     180x180  opaque (iOS flattens alpha)
 *
 * Run with:  pnpm pwa:icons   (from apps/web)
 *
 * The "L" path is centred within the 32x32 view-box, so the maskable variant —
 * a full brand-blue square plus the L — keeps the mark well inside the inner
 * 80% safe zone that Android masks clip to.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const BRAND = '#1f54dd';
const L_PATH = 'M10 7V25H22V21H14V7H10Z';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(scriptDir, '..', 'public');
const iconsDir = path.join(publicDir, 'icons');

/** Brand circle + L, transparent corners — used for purpose "any". */
const anySvg = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="${BRAND}"/><path d="${L_PATH}" fill="white"/></svg>`;

/** Full-bleed brand square + centred L — used for purpose "maskable" and iOS. */
const fullBleedSvg = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" fill="${BRAND}"/><path d="${L_PATH}" fill="white"/></svg>`;

async function renderPng(
  svg: string,
  size: number,
  { opaque = false }: { opaque?: boolean } = {},
): Promise<Buffer> {
  const pipeline = sharp(Buffer.from(svg), { density: 384 }).resize(size, size);
  if (opaque) pipeline.flatten({ background: BRAND });
  return pipeline.png().toBuffer();
}

async function main() {
  await mkdir(iconsDir, { recursive: true });

  const outputs: Array<[string, Buffer]> = [
    [path.join(iconsDir, 'icon-192.png'), await renderPng(anySvg, 192)],
    [path.join(iconsDir, 'icon-512.png'), await renderPng(anySvg, 512)],
    [path.join(iconsDir, 'maskable-192.png'), await renderPng(fullBleedSvg, 192)],
    [path.join(iconsDir, 'maskable-512.png'), await renderPng(fullBleedSvg, 512)],
    [
      path.join(publicDir, 'apple-touch-icon.png'),
      await renderPng(fullBleedSvg, 180, { opaque: true }),
    ],
  ];

  for (const [file, buffer] of outputs) {
    await writeFile(file, buffer);
    console.log(`✓ ${path.relative(publicDir, file)} (${buffer.length} bytes)`);
  }

  console.log(`\nDone — ${outputs.length} icons written to public/.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
