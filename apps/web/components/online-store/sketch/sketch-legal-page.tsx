import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { stripHtml } from "@/lib/util.seo-text";

import type { OnlineStoreDevice } from "../online-store.constants";
import type { OnlineStoreLegalValues } from "../util.online-store-form";
import { SketchBar } from "./sketch-bar";
import type { SketchPalette } from "./sketch-palette";

interface SketchLegalPageProps {
  palette: SketchPalette;
  device: OnlineStoreDevice;
  legal: OnlineStoreLegalValues;
}

/** Line widths of one paragraph, repeated; the last one is short. */
const PARAGRAPH_LINES = ["w-full", "w-11/12", "w-full", "w-2/3"] as const;

/** How many paragraph blocks a text is worth: one per 400 characters, one to six. */
const paragraphCount = (text: string): number =>
  Math.min(6, Math.max(1, Math.ceil(text.length / 400)));

/**
 * The terms page at its real sizes: the title in words, the text as bars,
 * as many blocks as the text is long. An empty document shows a dashed
 * frame so the store sees at once that the page has nothing yet.
 */
export const SketchLegalPage = ({ palette: p, device, legal }: SketchLegalPageProps) => {
  const t = useTranslations("storefront.footer");
  const tSketch = useTranslations("dashboard.onlineStore.sketch");
  const phone = device === "phone";
  const cgv = stripHtml(legal.cgv).trim();
  const paragraphs = cgv ? Array.from({ length: paragraphCount(cgv) }, (_, index) => index) : [];

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-3xl flex-col gap-8",
        phone ? "px-4 py-8" : "px-8 py-12",
      )}
      data-slot="sketch-legal"
    >
      <div className="flex flex-col gap-3">
        <SketchBar className={cn("h-3 w-16", p.inkSoft)} />
        <h1 className={cn("font-semibold tracking-tight", phone ? "text-2xl" : "text-3xl", p.text)}>
          {t("cgv")}
        </h1>
      </div>

      {paragraphs.length > 0 ? (
        <div className="flex flex-col gap-6">
          {paragraphs.map((index) => (
            <div key={index} className="flex flex-col gap-2">
              {index % 2 === 0 ? <SketchBar className={cn("mb-1 h-5 w-1/3", p.ink)} /> : null}
              {PARAGRAPH_LINES.map((width) => (
                <SketchBar key={width} className={cn("h-3.5", width, p.inkSoft)} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div
          className={cn(
            "flex h-40 items-center justify-center rounded-2xl border border-dashed text-sm",
            p.line,
            p.textSoft,
          )}
        >
          {tSketch("empty")}
        </div>
      )}

      <div className={cn("flex gap-6 border-t pt-6 text-sm", p.line, p.textSoft)}>
        <span className="underline underline-offset-4">{t("cgv")}</span>
        <span className="underline underline-offset-4">{t("legalNotice")}</span>
      </div>
    </div>
  );
};
