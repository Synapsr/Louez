import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { stripHtml } from "@/lib/util.seo-text";

import type { OnlineStoreDevice } from "../online-store.constants";
import type { OnlineStoreFormValues } from "../util.online-store-form";
import { SketchBar } from "./sketch-bar";
import type { SketchPalette } from "./sketch-palette";

interface SketchSeoPageProps {
  palette: SketchPalette;
  device: OnlineStoreDevice;
  values: OnlineStoreFormValues;
  name: string;
  /** The public host, `slug.domain`. */
  host: string;
}

/**
 * Not a storefront page but what search engines and messaging apps make of
 * it: a Google result and a share card at their real sizes, both built
 * from the identity and the share image, so the favicon, the tagline and
 * the photo are checked where they end up.
 */
export const SketchSeoPage = ({ palette: p, device, values, name, host }: SketchSeoPageProps) => {
  const t = useTranslations("dashboard.onlineStore.sketch");
  const { identity, home, seo } = values;
  const phone = device === "phone";
  const description = stripHtml(identity.tagline).trim() || stripHtml(identity.description).trim();
  const icon = identity.faviconUrl ?? identity.logoUrl;
  const image = seo.shareImageUrl ?? home.heroImages[0] ?? null;

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-2xl flex-col gap-10",
        phone ? "px-4 py-8" : "px-8 py-12",
      )}
      data-slot="sketch-seo"
    >
      <section className="flex flex-col gap-3">
        <p className={cn("text-xs font-medium tracking-wider uppercase", p.textSoft)}>
          {t("googleResult")}
        </p>
        <div className={cn("flex flex-col gap-2 rounded-2xl border p-6", p.line, p.surface)}>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border",
                p.line,
                p.fillSoft,
              )}
            >
              {icon ? (
                <img src={icon} alt="" className="h-full w-full object-contain p-0.5" />
              ) : (
                <span className={cn("text-xs font-semibold", p.textSoft)}>
                  {name.charAt(0).toUpperCase()}
                </span>
              )}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className={cn("truncate text-sm leading-tight", p.text)}>{name}</span>
              <span className={cn("truncate text-xs leading-tight", p.textSoft)}>{host}</span>
            </span>
          </div>
          <p className="truncate text-xl leading-snug text-[#1a0dab] dark:text-[#8ab4f8]">{name}</p>
          {description ? (
            <p className={cn("line-clamp-2 text-sm leading-snug", p.textSoft)}>{description}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <SketchBar className={cn("h-3 w-full", p.fill)} />
              <SketchBar className={cn("h-3 w-2/3", p.fill)} />
            </div>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <p className={cn("text-xs font-medium tracking-wider uppercase", p.textSoft)}>
          {t("shareCard")}
        </p>
        <div className={cn("overflow-hidden rounded-2xl border", p.line, p.surface)}>
          <div className={cn("relative aspect-[1.91/1]", p.fillSoft)}>
            {image ? (
              <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={cn("text-sm", p.textSoft)}>{t("noShareImage")}</span>
              </div>
            )}
          </div>
          <div className={cn("flex flex-col gap-1 border-t p-4", p.line)}>
            <span className={cn("truncate text-xs uppercase leading-tight", p.textSoft)}>
              {host}
            </span>
            <span className={cn("truncate text-base font-semibold leading-tight", p.text)}>
              {name}
            </span>
            {description ? (
              <span className={cn("line-clamp-1 text-sm leading-tight", p.textSoft)}>
                {description}
              </span>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
};
