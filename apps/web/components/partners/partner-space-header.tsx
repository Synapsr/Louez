import { ArrowUpRight } from "lucide-react";

import { cn } from "@louez/utils";

interface PartnerSpaceHeaderProps {
  storeName: string;
  storeUrl: string;
  logoUrl: string | null;
  /** The storefront's home photo: the banner shows it, darkened under the text. */
  heroImage: string | null;
  eyebrow: string;
  title: string;
  intro: string;
  visitStore: string;
}

/**
 * The top of a partner's space, in its store's look: the store's colour or
 * home photo, its logo (or name), and a word for the partner.
 */
export const PartnerSpaceHeader = ({
  storeName,
  storeUrl,
  logoUrl,
  heroImage,
  eyebrow,
  title,
  intro,
  visitStore,
}: PartnerSpaceHeaderProps) => (
  <header
    className={cn(
      "relative overflow-hidden",
      heroImage ? "bg-neutral-900 text-white" : "bg-primary text-primary-foreground",
    )}
  >
    {heroImage && (
      <>
        <img
          src={heroImage}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/45 to-black/65" />
      </>
    )}
    <div className="relative mx-auto max-w-2xl px-4 pt-6 pb-20 sm:pt-8">
      <div className="flex items-center justify-between gap-3">
        {logoUrl ? (
          <span className="flex h-12 items-center rounded-xl bg-white px-3 shadow-sm">
            <img src={logoUrl} alt={storeName} className="h-8 w-auto max-w-40 object-contain" />
          </span>
        ) : (
          <span className="truncate text-lg font-semibold tracking-tight">{storeName}</span>
        )}
        <a
          href={storeUrl}
          target="_blank"
          rel="noopener"
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium backdrop-blur-sm transition-colors hover:bg-white/25"
        >
          {visitStore}
          <ArrowUpRight className="size-4" aria-hidden />
        </a>
      </div>
      <p className="mt-10 text-sm font-medium opacity-85">{eyebrow}</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight text-balance sm:text-4xl">{title}</h1>
      <p className="mt-3 max-w-xl text-pretty opacity-90">{intro}</p>
    </div>
  </header>
);
