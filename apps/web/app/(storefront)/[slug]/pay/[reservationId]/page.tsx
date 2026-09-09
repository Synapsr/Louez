import { BanIcon, CheckIcon, CircleAlertIcon, InfoIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Button } from "@louez/ui";

import { OutcomeHeader } from "@/components/storefront/ui/outcome-header";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { generateStoreMetadata } from "@/lib/seo";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";

import { getPaymentRequestData, type PaymentRequestError } from "./actions";
import { PaymentRequestPage } from "./payment-request-page";

interface PayPageProps {
  params: Promise<{ slug: string; reservationId: string }>;
  searchParams: Promise<{ token?: string }>;
}

type OutcomeTone = "success" | "pending" | "info" | "destructive";

const ERROR_PRESENTATION: Record<
  Exclude<PaymentRequestError, "store_not_found" | "reservation_not_found">,
  { tone: OutcomeTone; icon: ReactNode; key: string }
> = {
  invalid_token: { tone: "destructive", icon: <CircleAlertIcon />, key: "expired" },
  already_paid: { tone: "success", icon: <CheckIcon />, key: "alreadyPaid" },
  cancelled: { tone: "info", icon: <BanIcon />, key: "cancelled" },
  stripe_not_configured: { tone: "info", icon: <InfoIcon />, key: "unavailable" },
  session_creation_failed: { tone: "destructive", icon: <CircleAlertIcon />, key: "error" },
};

export const instant = false;

export const generateMetadata = async ({ params }: PayPageProps): Promise<Metadata> => {
  const { slug } = await params;
  const [store, t] = await Promise.all([getStoreBySlug(slug), getTranslations("storefront.pay")]);

  if (!store) {
    return { title: t("amountDue") };
  }

  return generateStoreMetadata(
    {
      id: store.id,
      name: store.name,
      slug: store.slug,
      settings: store.settings,
      theme: store.theme,
    },
    { title: `${t("amountDue")} - ${store.name}`, noIndex: true },
  );
};

const PayPage = async ({ params, searchParams }: PayPageProps) => {
  const [{ slug, reservationId }, { token }, t] = await Promise.all([
    params,
    searchParams,
    getTranslations("storefront.pay"),
  ]);

  const data = await getPaymentRequestData({ slug, reservationId, token });

  if (!data.ok) {
    if (data.error === "store_not_found" || data.error === "reservation_not_found") {
      notFound();
    }

    const presentation = ERROR_PRESENTATION[data.error];
    return (
      <StorefrontSection width="narrow">
        <OutcomeHeader
          tone={presentation.tone}
          icon={presentation.icon}
          title={t(`errors.${presentation.key}Title`)}
          description={t(`errors.${presentation.key}Description`)}
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

  return (
    <StorefrontSection width="narrow">
      <PaymentRequestPage
        slug={data.store.slug}
        storeName={data.store.name}
        reservation={data.reservation}
        paymentRequest={data.paymentRequest}
        customerFirstName={data.customer.firstName}
        token={token ?? ""}
      />
    </StorefrontSection>
  );
};

export default PayPage;
