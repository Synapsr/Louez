import type { ReactNode } from "react";

import Link from "next/link";
import { getTranslations } from "next-intl/server";

interface MarketplaceStorefrontShellProps {
  children: ReactNode;
  logoUrl?: string | null;
  marketplaceUrl?: string;
  storeName: string;
}

export const MarketplaceStorefrontShell = async ({
  children,
  logoUrl,
  marketplaceUrl,
  storeName,
}: MarketplaceStorefrontShellProps) => {
  const tFooter = await getTranslations("storefront.footer");
  const tMarketplace = await getTranslations("storefront.marketplaceShell");

  const marketplaceBadge = (
    <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
      {tMarketplace("marketplaceName")}
    </span>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-background/95">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <Link href="/?channel=marketplace" className="flex min-w-0 items-center gap-2.5">
            {logoUrl ? (
              <img src={logoUrl} alt={storeName} className="h-8 max-w-28 object-contain" />
            ) : null}
            <span className="truncate text-sm font-semibold text-foreground">{storeName}</span>
          </Link>

          {marketplaceUrl ? (
            <a href={marketplaceUrl} className="shrink-0">
              {marketplaceBadge}
            </a>
          ) : (
            <div className="shrink-0">{marketplaceBadge}</div>
          )}
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border px-4 py-4 text-xs text-muted-foreground md:px-6">
        <nav
          aria-label={tFooter("legalInfo")}
          className="mx-auto flex w-full max-w-6xl items-center justify-center gap-4"
        >
          <Link href="/terms" className="hover:text-foreground">
            {tFooter("cgv")}
          </Link>
          <Link href="/legal" className="hover:text-foreground">
            {tFooter("legalNotice")}
          </Link>
        </nav>
      </footer>
    </div>
  );
};
