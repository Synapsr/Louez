"use client";

import { useTranslations } from "next-intl";

import { Avatar, AvatarFallback, AvatarImage } from "@louez/ui";

// Photos live in apps/web/public/images/founders/ (square, ~160px is enough);
// until a photo is added the avatar falls back to the founder's initial.
const FOUNDERS = [
  { name: "Téo", image: "/images/founders/teo.webp" },
  { name: "Loan", image: "/images/founders/loan.webp" },
  { name: "Ryan", image: "/images/founders/ryan.webp" },
] as const;

/**
 * Right-column companion of the source (last) step: the store is set up, so
 * instead of a storefront preview, a short personal note from the founders —
 * welcome, and where to reach us (the Gleap chat bubble is mounted on the
 * whole dashboard group, onboarding included).
 */
export function FounderNotePanel() {
  const t = useTranslations("onboarding.source.panel");

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-6 duration-500">
      <div className="space-y-4">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {t("title")}
        </h2>
        <p className="text-sm leading-relaxed">{t("p1")}</p>
        <p className="text-sm leading-relaxed">{t("p2")}</p>
      </div>

      <div className="flex items-center gap-1.5">
        <div className="flex -space-x-2">
          {FOUNDERS.map((founder) => (
            <Avatar key={founder.name} className="border-background size-7 border-2">
              <AvatarImage src={founder.image} alt={founder.name} />
              <AvatarFallback className="text-[8px] font-semibold">
                {founder.name.charAt(0)}
              </AvatarFallback>
            </Avatar>
          ))}
        </div>
        <p className="text-muted-foreground text-sm">{t("signature")}</p>
      </div>
    </div>
  );
}
