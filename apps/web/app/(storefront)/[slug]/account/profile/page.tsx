import { CustomerCommunicationsForm } from "@/components/storefront/account/customer-communications-form";
import { getCustomerReminderPreferences } from "@/lib/notifications/customer-reminder-preferences";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CustomerProfileForm } from "@/components/storefront/account/customer-profile-form";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { requireCustomerSession } from "@/lib/customer-auth/require-customer-session";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { toCheckoutInitialCustomer } from "@/app/(storefront)/[slug]/checkout/util.checkout-customer";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("storefront.account.profile");
  return { title: t("title"), robots: { index: false, follow: false } };
};

const CustomerProfilePage = async ({ params }: { params: Promise<{ slug: string }> }) => {
  const { slug } = await params;
  const store = await getStoreBySlug(slug);
  if (!store) notFound();
  const session = await requireCustomerSession(store, "/account/profile");
  const preferences = await getCustomerReminderPreferences(store.id, session.customerId);
  const t = await getTranslations("storefront.account.profile");
  return (
    <StorefrontSection contentClassName="flex max-w-2xl flex-col gap-6 sm:gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <CustomerProfileForm
        initialCustomer={toCheckoutInitialCustomer(session.customer)}
        storeSlug={slug}
        country={store.settings?.country ?? "FR"}
      />
      <CustomerCommunicationsForm storeSlug={slug} preferences={preferences} />
    </StorefrontSection>
  );
};

export default CustomerProfilePage;
