import { CircleAlertIcon, InfoIcon, ShieldCheckIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Button } from "@louez/ui";

import { OutcomeHeader } from "@/components/storefront/ui/outcome-header";
import { SectionHeader } from "@/components/storefront/ui/section-header";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { env } from "@/env";
import { locales, type Locale } from "@/i18n/config";
import { generateStoreMetadata } from "@/lib/seo";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";

import { getDepositAuthorizationData, type DepositAuthorizationError } from "./actions";
import { DepositForm } from "./deposit-form";

interface AuthorizeDepositPageProps {
  params: Promise<{ slug: string; reservationId: string }>;
  searchParams: Promise<{ token?: string }>;
}

type OutcomeTone = "success" | "pending" | "info" | "destructive";

const ERROR_PRESENTATION: Record<
  Exclude<DepositAuthorizationError, "store_not_found" | "reservation_not_found">,
  { tone: OutcomeTone; key: string }
> = {
  invalid_token: { tone: "destructive", key: "errors.invalidToken" },
  stripe_not_configured: { tone: "info", key: "errors.stripeNotConfigured" },
  deposit_already_authorized: { tone: "success", key: "errors.alreadyAuthorized" },
  no_deposit_required: { tone: "info", key: "errors.noDepositRequired" },
  payment_intent_creation_failed: { tone: "destructive", key: "paymentInitError" },
  not_authorized: { tone: "destructive", key: "errors.notAuthorized" },
  confirmation_failed: { tone: "destructive", key: "confirmationError" },
};

const OUTCOME_ICONS: Record<OutcomeTone, ReactNode> = {
  success: <ShieldCheckIcon />,
  pending: <InfoIcon />,
  info: <InfoIcon />,
  destructive: <CircleAlertIcon />,
};

const isLocale = (value: string): value is Locale => (locales as readonly string[]).includes(value);

export const instant = false;

export const generateMetadata = async ({
  params,
}: AuthorizeDepositPageProps): Promise<Metadata> => {
  const { slug } = await params;
  const [store, t] = await Promise.all([
    getStoreBySlug(slug),
    getTranslations("storefront.authorizeDeposit"),
  ]);

  if (!store) {
    return { title: t("title") };
  }

  return generateStoreMetadata(
    {
      id: store.id,
      name: store.name,
      slug: store.slug,
      settings: store.settings,
      theme: store.theme,
    },
    { title: `${t("title")} - ${store.name}`, noIndex: true },
  );
};

const AuthorizeDepositPage = async ({ params, searchParams }: AuthorizeDepositPageProps) => {
  const [{ slug, reservationId }, { token }, t, locale] = await Promise.all([
    params,
    searchParams,
    getTranslations("storefront.authorizeDeposit"),
    getLocale(),
  ]);

  const data = await getDepositAuthorizationData({ slug, reservationId, token });

  if (!data.ok) {
    if (data.error === "store_not_found" || data.error === "reservation_not_found") {
      notFound();
    }

    const presentation = ERROR_PRESENTATION[data.error];
    return (
      <StorefrontSection width="narrow">
        <OutcomeHeader
          tone={presentation.tone}
          icon={OUTCOME_ICONS[presentation.tone]}
          title={t("title")}
          description={t(presentation.key)}
        >
          <Button
            variant="outline"
            size="xl"
            className="h-12 w-full lg:h-10 sm:w-auto"
            render={<StorefrontLink href="/" />}
          >
            {t("backToStore")}
          </Button>
        </OutcomeHeader>
      </StorefrontSection>
    );
  }

  const { store, reservation, currency } = data;

  return (
    <StorefrontSection width="narrow">
      <SectionHeader
        level="h1"
        align="center"
        title={t("title")}
        description={t("subtitle", { number: reservation.number })}
      />
      <div className="rounded-2xl bg-card p-4 shadow-card sm:p-6">
        <DepositForm
          slug={store.slug}
          reservationId={reservation.id}
          token={token ?? ""}
          depositAmount={reservation.depositAmount}
          currency={currency}
          stripeAccountId={store.stripeAccountId}
          stripePublishableKey={env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""}
          locale={isLocale(locale) ? locale : "auto"}
          theme={store.theme}
        />
      </div>
    </StorefrontSection>
  );
};

export default AuthorizeDepositPage;
