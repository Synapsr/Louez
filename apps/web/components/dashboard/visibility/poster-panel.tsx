"use client";

import { useEffect, useRef, useState } from "react";

import { log } from "evlog/next/client";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { QRCodeCanvas } from "qrcode.react";

import { Button, Spinner } from "@louez/ui";

import { withVisitSource } from "@/lib/visibility/util.visit-source";

import { useVisibilityAnalytics, type VisibilityPlacement } from "./use-visibility-analytics";
import { drawPoster, toDisplayUrl } from "./util.poster";

const QR_RENDER_SIZE = 860;

interface PosterPanelProps {
  storeId: string;
  storeName: string;
  storeSlug: string;
  storeUrl: string;
  placement: VisibilityPlacement;
}

/**
 * The counter poster: the store's name, its QR code (marked `via=qr`) and its
 * address, saved as a PNG the loueur prints or keeps on their phone.
 */
export const PosterPanel = ({
  storeId,
  storeName,
  storeSlug,
  storeUrl,
  placement,
}: PosterPanelProps) => {
  const t = useTranslations("dashboard.visibility.poster");
  const analytics = useVisibilityAnalytics(storeId);
  const qrRef = useRef<HTMLCanvasElement>(null);
  const [poster, setPoster] = useState<{ canvas: HTMLCanvasElement; preview: string } | null>(null);
  const headline = t("headline");
  const scanHint = t("scanHint");

  useEffect(() => {
    const qr = qrRef.current;
    if (!qr) return;
    const canvas = document.createElement("canvas");
    drawPoster(canvas, {
      storeName,
      headline,
      scanHint,
      displayUrl: toDisplayUrl(storeUrl),
      qr,
    });
    setPoster({ canvas, preview: canvas.toDataURL("image/png") });
  }, [headline, scanHint, storeName, storeUrl]);

  const save = () => {
    if (!poster) return;
    poster.canvas.toBlob((blob) => {
      if (!blob) return;
      const fileName = `${t("fileName")}-${storeSlug}.png`;
      analytics.shareUsed(placement, "qr", "store");
      const file = new File([blob], fileName, { type: "image/png" });
      // A phone saves it to its photos through the share sheet.
      if (navigator.canShare?.({ files: [file] })) {
        navigator.share({ files: [file] }).catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          log.warn({ action: "visibility_poster_share_failed", error: String(error) });
        });
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  };

  return (
    <div className="space-y-4">
      {/* The code the poster draws; never shown on its own. */}
      <QRCodeCanvas
        ref={qrRef}
        value={withVisitSource(storeUrl, "qr")}
        size={QR_RENDER_SIZE}
        level="M"
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
      <p className="text-muted-foreground text-sm">{t("hint")}</p>
      <Button className="w-full" onClick={save} disabled={!poster}>
        <Download />
        {t("save")}
      </Button>
    </div>
  );
};
