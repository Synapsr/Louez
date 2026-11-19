"use client";

import { useEffect, useState } from "react";

import { log } from "evlog/next/client";

import { INK, POSTER_QR_SIZE, isSquarish, monogram, posterColors } from "./util.poster";

const CENTRE_SIZE = 256;

/**
 * What sits at the centre of the code, as a PNG data URL: the store's logo
 * when it is squarish, else its initial on a tile of its colour. Null when
 * the name has no letter to show either.
 */
function drawCentre(
  logo: HTMLImageElement | null,
  storeName: string,
  accentColor: string | null | undefined,
): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = CENTRE_SIZE;
  canvas.height = CENTRE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  if (logo && logo.naturalWidth > 0 && isSquarish(logo)) {
    const ratio = Math.min(CENTRE_SIZE / logo.naturalWidth, CENTRE_SIZE / logo.naturalHeight);
    const width = logo.naturalWidth * ratio;
    const height = logo.naturalHeight * ratio;
    ctx.drawImage(logo, (CENTRE_SIZE - width) / 2, (CENTRE_SIZE - height) / 2, width, height);
    return canvas.toDataURL("image/png");
  }

  // A wide logo would shrink to a line there: the store's initial reads better.
  const initial = monogram(storeName);
  if (!initial) return null;
  const colors = posterColors(accentColor);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(0, 0, CENTRE_SIZE, CENTRE_SIZE, 64);
  else ctx.rect(0, 0, CENTRE_SIZE, CENTRE_SIZE);
  ctx.fillStyle = colors.accent;
  ctx.fill();
  ctx.fillStyle = colors.onAccent;
  ctx.font = `800 ${Math.round(CENTRE_SIZE * 0.6)}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initial, CENTRE_SIZE / 2, CENTRE_SIZE / 2 + CENTRE_SIZE * 0.04);
  return canvas.toDataURL("image/png");
}

/**
 * The poster's QR code, drawn by qr-code-styling: rounded black modules,
 * corner eyes in the store's colour when it is dark enough to scan, and the
 * store's logo (or initial) at the centre, over the dots it hides; the highest
 * error correction keeps it readable. `undefined` while it draws.
 */
export const usePosterCode = ({
  url,
  storeName,
  accentColor,
  logo,
}: {
  url: string;
  storeName: string;
  accentColor: string | null | undefined;
  /** The loaded logo; `undefined` while it loads, and the code waits for it. */
  logo: HTMLImageElement | null | undefined;
}) => {
  const [code, setCode] = useState<ImageBitmap | null | undefined>(undefined);

  useEffect(() => {
    if (logo === undefined) return;
    let cancelled = false;
    setCode(undefined);

    const draw = async () => {
      // The library touches `window` when it loads: only in the browser.
      const { default: QRCodeStyling } = await import("qr-code-styling");
      const eyes = posterColors(accentColor).code;
      const centre = drawCentre(logo, storeName, accentColor);
      const qr = new QRCodeStyling({
        type: "canvas",
        width: POSTER_QR_SIZE,
        height: POSTER_QR_SIZE,
        margin: 0,
        data: url,
        image: centre ?? undefined,
        qrOptions: { errorCorrectionLevel: "H" },
        // The centre is already a data URL: no fetch, which the CSP refuses for `data:`.
        imageOptions: { hideBackgroundDots: true, imageSize: 0.32, margin: 14, saveAsBlob: false },
        dotsOptions: { type: "rounded", color: INK },
        cornersSquareOptions: { type: "extra-rounded", color: eyes },
        cornersDotOptions: { type: "rounded", color: eyes },
        backgroundOptions: { color: "#ffffff" },
      });
      const blob = await qr.getRawData("png");
      if (!(blob instanceof Blob)) throw new Error("qr-code-styling returned no PNG");
      return createImageBitmap(blob);
    };

    draw()
      .then((bitmap) => {
        if (!cancelled) setCode(bitmap);
      })
      .catch((error: unknown) => {
        log.warn({ action: "visibility_poster_code_failed", error: String(error) });
        if (!cancelled) setCode(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, storeName, accentColor, logo]);

  return code;
};
