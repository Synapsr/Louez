/**
 * The QR poster of the "Se faire connaître" guide, drawn on a canvas in the
 * browser: an A4 page at 150 dpi, black on white so any printer renders it.
 */

export const POSTER_WIDTH = 1240;
export const POSTER_HEIGHT = 1754;
const MARGIN = 110;
const QR_SIZE = 860;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export interface PosterContent {
  storeName: string;
  headline: string;
  scanHint: string;
  /** The address printed under the code, without protocol or marking. */
  displayUrl: string;
  /** The QR code, already drawn (qrcode.react's canvas). */
  qr: CanvasImageSource;
}

/**
 * Splits a text into lines that fit `maxWidth`, at most `maxLines`; the last
 * one ends with an ellipsis when the text is cut. A word wider than a line
 * stays whole on its own line: the caller shrinks the font for those.
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]}…`;
  while (last.length > 1 && measure(last) > maxWidth) {
    last = `${last.slice(0, -2)}…`;
  }
  kept[maxLines - 1] = last;
  return kept;
}

/** The address as people read it: no protocol, no trailing slash. */
export function toDisplayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** Font size that fits the longest word of `text` on one line, from `largest` down. */
function fittingSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  largest: number,
  smallest: number,
  maxWidth: number,
): number {
  const longest = text.split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), "");
  for (let size = largest; size > smallest; size -= 4) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(longest).width <= maxWidth) return size;
  }
  return smallest;
}

export function drawPoster(canvas: HTMLCanvasElement, content: PosterContent): void {
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = POSTER_WIDTH - MARGIN * 2;
  const center = POSTER_WIDTH / 2;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  ctx.fillStyle = "#0a0a0a";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // The store's name, two lines at most.
  const nameSize = fittingSize(ctx, content.storeName, 800, 104, 56, width);
  ctx.font = `800 ${nameSize}px ${FONT}`;
  const nameLines = wrapLines(content.storeName, width, (value) => ctx.measureText(value).width, 2);
  let y = MARGIN + nameSize;
  for (const line of nameLines) {
    ctx.fillText(line, center, y);
    y += nameSize * 1.15;
  }

  // What the code does.
  const headlineSize = fittingSize(ctx, content.headline, 600, 72, 40, width);
  ctx.font = `600 ${headlineSize}px ${FONT}`;
  y += headlineSize * 0.5;
  for (const line of wrapLines(
    content.headline,
    width,
    (value) => ctx.measureText(value).width,
    2,
  )) {
    ctx.fillText(line, center, y);
    y += headlineSize * 1.2;
  }

  // The code, centered in the space left above the footer.
  const footerTop = POSTER_HEIGHT - MARGIN - 150;
  const qrTop = Math.max(y + 20, (y + footerTop - QR_SIZE) / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(content.qr, center - QR_SIZE / 2, qrTop, QR_SIZE, QR_SIZE);

  // How to scan it, and the address for those who type it.
  ctx.fillStyle = "#525252";
  ctx.font = `400 40px ${FONT}`;
  const hint = wrapLines(content.scanHint, width, (value) => ctx.measureText(value).width, 1)[0];
  ctx.fillText(hint ?? "", center, footerTop + 40);
  ctx.fillStyle = "#0a0a0a";
  const urlSize = fittingSize(ctx, content.displayUrl, 700, 52, 28, width);
  ctx.font = `700 ${urlSize}px ${FONT}`;
  ctx.fillText(content.displayUrl, center, footerTop + 40 + urlSize * 1.8);
}
