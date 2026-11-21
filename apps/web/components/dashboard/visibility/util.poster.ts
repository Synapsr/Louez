import { getContrastForeground, parseHexColor } from "@/lib/theme/util.store-theme";

/**
 * The QR poster of « Se faire connaître » and of a store's partners, drawn on
 * a canvas in the browser: an A4 page at 150 dpi, in the store's colours, with
 * its logo. The code itself stays dark on white, so any phone reads it, and
 * any printer renders it; only its corner eyes take the store's colour.
 */

export const POSTER_WIDTH = 1240;
export const POSTER_HEIGHT = 1754;
const MARGIN = 110;
const BAND_HEIGHT = 560;
export const POSTER_QR_SIZE = 800;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const INK = "#0a0a0a";
const MUTED = "#525252";

export interface PosterContent {
  storeName: string;
  headline: string;
  scanHint: string;
  /** The QR code, already drawn with its centre (`usePosterCode`). */
  qr: CanvasImageSource;
  /** The store's colour (`#rrggbb`); the platform's ink when it has none. */
  accentColor?: string | null;
  /** The store's logo, loaded so the canvas may export it; null prints its name. */
  logo?: HTMLImageElement | null;
  /** On a partner's poster: "Recommandé par Camping Les Pins". */
  recommendedBy?: string | null;
}

export interface PosterColors {
  /** The band behind the store's name. */
  accent: string;
  /** What reads on the band. */
  onAccent: string;
  /** The code's eyes and the partner line: the store's colour when it is dark enough to scan, else ink. */
  code: string;
}

/** WCAG relative luminance of a parsed colour. */
const luminance = ({ r, g, b }: { r: number; g: number; b: number }): number => {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/**
 * The poster's colours from the store's: its colour for the band, and for
 * the code only when it contrasts with white as text must (4.5:1), so a
 * yellow or a pastel store still prints a code every phone reads.
 */
export function posterColors(accentColor: string | null | undefined): PosterColors {
  const parsed = accentColor ? parseHexColor(accentColor) : null;
  if (!parsed || !accentColor) return { accent: INK, onAccent: "#ffffff", code: INK };
  const accent = accentColor.startsWith("#") ? accentColor : `#${accentColor}`;
  const contrastWithWhite = 1.05 / (luminance(parsed) + 0.05);
  return {
    accent,
    onAccent: getContrastForeground(accent) ?? "#ffffff",
    code: contrastWithWhite >= 4.5 ? accent : INK,
  };
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

/** A logo that fits the code's centre: no wider than twice its height. */
export const isSquarish = (image: { naturalWidth: number; naturalHeight: number }): boolean =>
  image.naturalHeight > 0 && image.naturalWidth / image.naturalHeight <= 2;

/** The store's initial, for the code's centre: its first letter or digit. */
export const monogram = (storeName: string): string =>
  storeName
    .trim()
    .match(/[\p{L}\p{N}]/u)?.[0]
    ?.toLocaleUpperCase() ?? "";

/** A rounded rectangle's path; a plain one where the canvas has no `roundRect`. */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, width, height, radius);
  else ctx.rect(x, y, width, height);
}

/** The logo inside a box, its proportions kept, centred. */
function drawContained(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  box: { x: number; y: number; width: number; height: number },
) {
  const ratio = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
  const width = image.naturalWidth * ratio;
  const height = image.naturalHeight * ratio;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    image,
    box.x + (box.width - width) / 2,
    box.y + (box.height - height) / 2,
    width,
    height,
  );
}

export function drawPoster(canvas: HTMLCanvasElement, content: PosterContent): void {
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const colors = posterColors(content.accentColor);
  const width = POSTER_WIDTH - MARGIN * 2;
  const center = POSTER_WIDTH / 2;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // The band in the store's colour: its logo on a white card, or its name.
  ctx.fillStyle = colors.accent;
  ctx.fillRect(0, 0, POSTER_WIDTH, BAND_HEIGHT);
  let y = MARGIN;
  if (content.logo && content.logo.naturalWidth > 0) {
    const card = { width: 560, height: 220 };
    roundedRect(ctx, center - card.width / 2, y, card.width, card.height, 36);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    drawContained(ctx, content.logo, {
      x: center - card.width / 2 + 40,
      y: y + 32,
      width: card.width - 80,
      height: card.height - 64,
    });
    y += card.height + 90;
  } else {
    ctx.fillStyle = colors.onAccent;
    const nameSize = fittingSize(ctx, content.storeName, 800, 104, 56, width);
    ctx.font = `800 ${nameSize}px ${FONT}`;
    const nameLines = wrapLines(
      content.storeName,
      width,
      (value) => ctx.measureText(value).width,
      2,
    );
    y += nameSize;
    for (const line of nameLines) {
      ctx.fillText(line, center, y);
      y += nameSize * 1.15;
    }
    y += 10;
  }

  // What the code does, on the band too.
  ctx.fillStyle = colors.onAccent;
  const headlineSize = fittingSize(ctx, content.headline, 700, 76, 40, width);
  ctx.font = `700 ${headlineSize}px ${FONT}`;
  const headline = wrapLines(content.headline, width, (value) => ctx.measureText(value).width, 1);
  ctx.fillText(headline[0] ?? "", center, Math.min(y, BAND_HEIGHT - 60));

  // Who recommends the store, on a partner's poster.
  let qrTop = BAND_HEIGHT + 90;
  if (content.recommendedBy) {
    ctx.fillStyle = colors.code;
    const size = fittingSize(ctx, content.recommendedBy, 700, 52, 32, width);
    ctx.font = `700 ${size}px ${FONT}`;
    const line = wrapLines(
      content.recommendedBy,
      width,
      (value) => ctx.measureText(value).width,
      1,
    );
    ctx.fillText(line[0] ?? "", center, BAND_HEIGHT + 100);
    qrTop += 70;
  }

  // The code, centred between the band and the hint under it.
  const hintBaseline = POSTER_HEIGHT - MARGIN;
  const room = hintBaseline - 100 - qrTop;
  const qrSize = Math.min(POSTER_QR_SIZE, room);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(content.qr, center - qrSize / 2, qrTop + (room - qrSize) / 2, qrSize, qrSize);

  // How to scan it.
  ctx.fillStyle = MUTED;
  ctx.font = `400 40px ${FONT}`;
  const hint = wrapLines(content.scanHint, width, (value) => ctx.measureText(value).width, 1)[0];
  ctx.fillText(hint ?? "", center, hintBaseline);
}
