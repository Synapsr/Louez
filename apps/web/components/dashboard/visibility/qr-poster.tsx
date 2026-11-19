"use client";

import { useEffect, useRef, useState } from "react";

import { log } from "evlog/next/client";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { QRCodeCanvas } from "qrcode.react";

import { Button, Spinner } from "@louez/ui";

import { usePosterLogo } from "./use-poster-logo";
import { POSTER_QR_SIZE, drawPoster, posterColors, toDisplayUrl } from "./util.poster";

interface QrPosterProps {
  storeName: string;
  /** What the code opens, marked with its source or partner. */
  url: string;
  /** The address printed under the code; the store's plain address by default. */
  displayUrl: string;
  /** Without extension. */
  fileName: string;
  hint: string;
  onSave: () => void;
  /** The store's colour (`#rrggbb`): the band, and the code when it is dark enough. */
  accentColor?: string | null;
  /** The store's logo: on the band and at the centre of the code. */
  logoUrl?: string | null;
  /** On a partner's poster: "Recommandé par Camping Les Pins". */
  recommendedBy?: string | null;
}

/**
 * An A4 poster in the store's colours: its logo (or name), a QR code and an
 * address, saved as a PNG the loueur (or its partner) prints or keeps on a phone.
 */
export const QrPoster = ({
  storeName,
  url,
  displayUrl,
  fileName,
  hint,
  onSave,
  accentColor,
  logoUrl,
  recommendedBy,
}: QrPosterProps) => {
  const t = useTranslations("dashboard.visibility.poster");
  const qrRef = useRef<HTMLCanvasElement>(null);
  const [poster, setPoster] = useState<{ canvas: HTMLCanvasElement; preview: string } | null>(null);
  const headline = t("headline");
  const scanHint = t("scanHint");
  const logo = usePosterLogo(logoUrl);
  const colors = posterColors(accentColor);

  useEffect(() => {
    const qr = qrRef.current;
    // Wait for the logo, so the poster is drawn once with it or without it.
    if (!qr || logo === undefined) return;
    const canvas = document.createElement("canvas");
    drawPoster(canvas, {
      storeName,
      headline,
      scanHint,
      displayUrl: toDisplayUrl(displayUrl),
      qr,
      accentColor,
      logo,
      recommendedBy,
    });
    setPoster({ canvas, preview: canvas.toDataURL("image/png") });
  }, [headline, scanHint, storeName, displayUrl, url, accentColor, logo, recommendedBy]);

  const save = () => {
    if (!poster) return;
    poster.canvas.toBlob((blob) => {
      if (!blob) return;
      const name = `${fileName}.png`;
      onSave();
      const file = new File([blob], name, { type: "image/png" });
      // A phone saves it to its photos through the share sheet.
      if (navigator.canShare?.({ files: [file] })) {
        navigator.share({ files: [file] }).catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          log.warn({ action: "visibility_poster_share_failed", error: String(error) });
        });
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }, "image/png");
  };

  return (
    <div className="space-y-4">
      {/* The code the poster draws; never shown on its own. */}
      <QRCodeCanvas
        ref={qrRef}
        value={url}
        size={POSTER_QR_SIZE}
        // A logo covers its centre: the highest correction keeps it readable.
        level={logo ? "H" : "M"}
        fgColor={colors.code}
        marginSize={0}
        className="hidden"
        aria-hidden
      />
      <div className="bg-muted/40 flex justify-center rounded-xl p-4">
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL drawn in the browser
          <img
            src={poster.preview}
            alt={t("previewAlt")}
            className="h-auto w-48 rounded-md shadow-sm ring-1 ring-black/10 sm:w-56"
          />
        ) : (
          <div className="flex h-72 items-center justify-center">
            <Spinner />
          </div>
        )}
      </div>
      <p className="text-muted-foreground text-sm">{hint}</p>
      <Button className="w-full" onClick={save} disabled={!poster}>
        <Download />
        {t("save")}
      </Button>
    </div>
  );
};
