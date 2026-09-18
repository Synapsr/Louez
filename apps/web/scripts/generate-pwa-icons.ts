/**
 * Generates every Louez icon from a single source: `public/favicon.svg`.
 *
 * The mark's artwork is read out of that file at run time, so there is nothing
 * to keep in sync by hand — change favicon.svg, re-run this script, done.
 *
 *   app/icon.png                    32x32    transparent  (Next file convention)
 *   app/favicon.ico                 16+32    transparent  (/favicon.ico)
 *   app/apple-icon.png              180x180  white ground (Next file convention)
 *   public/favicon-16x16.png        16x16    transparent  (metadata.icons)
 *   public/favicon-32x32.png        32x32    transparent
 *   public/apple-touch-icon.png     180x180  white ground (iOS flattens alpha)
 *   public/icons/icon-192.png       192x192  white ground, purpose "any"
 *   public/icons/icon-512.png       512x512  white ground, purpose "any"
 *   public/icons/maskable-192.png   192x192  white ground, purpose "maskable"
 *   public/icons/maskable-512.png   512x512  white ground, purpose "maskable"
 *   ../../.github/assets/logo.png   160x160  transparent  (README header)
 *
 * Run with:  pnpm pwa:icons   (from apps/web)
 *
 * Android masks clip a maskable icon to its inner 80%, so the mark is drawn at
 * 58% of the canvas there — well inside the safe zone whatever shape the
 * launcher applies. The other grounded sizes give it 72%, and the bare favicons
 * let it run to 92% so it still reads at 16px.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

/** Ground for the icons that cannot be transparent (iOS, Android maskable). */
const GROUND = '#FFFFFF';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, '..');
const publicDir = path.join(webDir, 'public');
const appDir = path.join(webDir, 'app');
const iconsDir = path.join(publicDir, 'icons');
const githubAssetsDir = path.resolve(webDir, '..', '..', '.github', 'assets');

/** The mark, straight out of favicon.svg: its view-box and everything inside it. */
async function readMark(): Promise<{ viewBox: string; body: string }> {
  const svg = await readFile(path.join(publicDir, 'favicon.svg'), 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  const body = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg)?.[1];
  if (!viewBox || !body) throw new Error('public/favicon.svg: no viewBox or no body to read.');
  return { viewBox, body: body.trim() };
}

type Variant = { ground?: string; coverage: number };

/** Composes the mark at `size` px, centred, optionally on a solid ground. */
function compose(mark: { viewBox: string; body: string }, size: number, variant: Variant): string {
  const inner = Math.round(size * variant.coverage);
  const offset = (size - inner) / 2;
  const ground = variant.ground
    ? `<rect width="${size}" height="${size}" fill="${variant.ground}"/>`
    : '';
  return [
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"`,
    ` xmlns="http://www.w3.org/2000/svg">${ground}`,
    `<svg x="${offset}" y="${offset}" width="${inner}" height="${inner}"`,
    ` viewBox="${mark.viewBox}">${mark.body}</svg></svg>`,
  ].join('');
}

async function renderPng(svg: string, size: number): Promise<Buffer> {
  return sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Packs PNGs into an .ico. Every browser that still asks for /favicon.ico reads
 * PNG-in-ICO, and sharp has no .ico encoder of its own.
 */
function packIco(images: Array<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries: Buffer[] = [];
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

const BARE: Variant = { coverage: 0.92 };
const GROUNDED: Variant = { ground: GROUND, coverage: 0.72 };
const MASKABLE: Variant = { ground: GROUND, coverage: 0.58 };

async function main() {
  const mark = await readMark();
  await mkdir(iconsDir, { recursive: true });
  await mkdir(githubAssetsDir, { recursive: true });

  const png = (size: number, variant: Variant) => renderPng(compose(mark, size, variant), size);

  const favicon16 = await png(16, BARE);
  const favicon32 = await png(32, BARE);
  const apple = await png(180, GROUNDED);

  const outputs: Array<[string, Buffer]> = [
    [path.join(appDir, 'icon.png'), favicon32],
    [path.join(appDir, 'favicon.ico'), packIco([
      { size: 16, png: favicon16 },
      { size: 32, png: favicon32 },
    ])],
    [path.join(appDir, 'apple-icon.png'), apple],
    [path.join(publicDir, 'favicon-16x16.png'), favicon16],
    [path.join(publicDir, 'favicon-32x32.png'), favicon32],
    [path.join(publicDir, 'apple-touch-icon.png'), apple],
    [path.join(iconsDir, 'icon-192.png'), await png(192, GROUNDED)],
    [path.join(iconsDir, 'icon-512.png'), await png(512, GROUNDED)],
    [path.join(iconsDir, 'maskable-192.png'), await png(192, MASKABLE)],
    [path.join(iconsDir, 'maskable-512.png'), await png(512, MASKABLE)],
    [path.join(githubAssetsDir, 'logo.png'), await png(160, BARE)],
  ];

  for (const [file, buffer] of outputs) {
    await writeFile(file, buffer);
    console.log(`✓ ${path.relative(webDir, file)} (${buffer.length} bytes)`);
  }

  console.log(`\nDone — ${outputs.length} icons written from public/favicon.svg.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
