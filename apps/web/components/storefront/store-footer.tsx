"use client";

import { MailIcon, MapPinIcon, PhoneIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { useChromeVariant } from "@/components/storefront/shell/use-chrome-variant";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { LanguageSwitcher } from "@/components/ui/language-switcher";

interface StoreFooterProps {
  storeName: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  showAccount?: boolean;
}

const LINK_CLASS_NAME =
  "inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground sm:min-h-9";
const HEADING_CLASS_NAME = "text-xs font-semibold tracking-wider text-foreground uppercase";

/**
 * Footer on the muted band: contact, navigation, legal, account. Two columns
 * on phones, four from `sm`. Checkout gets the minimal variant
 * (legal links and copyright only) so nothing competes with the form.
 */
export const StoreFooter = ({
  storeName,
  email,
  phone,
  address,
  showAccount = true,
}: StoreFooterProps) => {
  const t = useTranslations("storefront.footer");
  const variant = useChromeVariant();
  const currentYear = new Date().getFullYear();

  const legalLinks = (
    <nav aria-label={t("legalInfo")} className="flex flex-col">
      <StorefrontLink href="/terms" className={LINK_CLASS_NAME}>
        {t("cgv")}
      </StorefrontLink>
      <StorefrontLink href="/legal" className={LINK_CLASS_NAME}>
        {t("legalNotice")}
      </StorefrontLink>
    </nav>
  );

  const bottomRow = (
    <div
      className={cn(
        "flex flex-col items-start gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between",
        variant !== "compact" && "mt-8 border-t pt-6",
      )}
    >
      <p>
        &copy; {currentYear} {storeName}. {t("allRightsReserved")}
      </p>
      <div className="flex items-center gap-3">
        <LanguageSwitcher
          variant="compact"
          className="text-muted-foreground hover:text-foreground"
        />
        <span aria-hidden>·</span>
        <p>
          {t("poweredBy")}{" "}
          <a
            href="https://louez.io"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground hover:underline"
          >
            Louez.io
          </a>
        </p>
      </div>
    </div>
  );

  if (variant === "compact") {
    return (
      <footer data-slot="store-footer" className="bg-muted py-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap gap-x-6">{legalLinks}</div>
          {bottomRow}
        </div>
      </footer>
    );
  }

  return (
    <footer data-slot="store-footer" className="bg-muted py-8 sm:py-12">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
            <p className="text-base font-semibold text-foreground">{storeName}</p>
            <div className="flex flex-col text-sm">
              {email ? (
                <a href={`mailto:${email}`} className={cn(LINK_CLASS_NAME, "gap-2")}>
                  <MailIcon aria-hidden className="size-4 shrink-0" />
                  <span className="truncate">{email}</span>
                </a>
              ) : null}
              {phone ? (
                <a href={`tel:${phone}`} className={cn(LINK_CLASS_NAME, "gap-2")}>
                  <PhoneIcon aria-hidden className="size-4 shrink-0" />
                  {phone}
                </a>
              ) : null}
              {address ? (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(LINK_CLASS_NAME, "items-start gap-2 py-2")}
                >
                  <MapPinIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span className="whitespace-pre-line">{address}</span>
                </a>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className={HEADING_CLASS_NAME}>{t("navigation")}</p>
            <nav aria-label={t("navigation")} className="flex flex-col">
              <StorefrontLink href="/catalog" className={LINK_CLASS_NAME}>
                {t("catalog")}
              </StorefrontLink>
              <StorefrontLink href="/about" className={LINK_CLASS_NAME}>
                {t("about")}
              </StorefrontLink>
              <StorefrontLink href="/#reviews" className={LINK_CLASS_NAME}>
                {t("reviews")}
              </StorefrontLink>
              <StorefrontLink href="/#contact" className={LINK_CLASS_NAME}>
                {t("contact")}
              </StorefrontLink>
            </nav>
          </div>

          <div className="flex flex-col gap-2">
            <p className={HEADING_CLASS_NAME}>{t("legalInfo")}</p>
            {legalLinks}
          </div>

          {showAccount ? (
            <div className="flex flex-col gap-2">
              <p className={HEADING_CLASS_NAME}>{t("account")}</p>
              <nav aria-label={t("account")} className="flex flex-col">
                <StorefrontLink href="/account/login" className={LINK_CLASS_NAME}>
                  {t("signIn")}
                </StorefrontLink>
                <StorefrontLink href="/account" className={LINK_CLASS_NAME}>
                  {t("myReservations")}
                </StorefrontLink>
              </nav>
            </div>
          ) : null}
        </div>

        {bottomRow}
      </div>
    </footer>
  );
};
