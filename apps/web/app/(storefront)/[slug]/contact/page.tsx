import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getLocale, getTranslations } from "next-intl/server";

import { ContactAside } from "@/components/storefront/contact/contact-aside";
import { ContactForm } from "@/components/storefront/contact/contact-form";
import { ContactPrimaryAction } from "@/components/storefront/contact/contact-primary-action";
import { StoreContactDetails } from "@/components/storefront/home/store-contact-details";
import { BackLink } from "@/components/storefront/ui/back-link";
import { SectionHeader } from "@/components/storefront/ui/section-header";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { generateLocalBusinessSchema, generateStoreMetadata, JsonLd } from "@/lib/seo";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import {
  hasStoreContactChannels,
  resolveStoreContactChannels,
} from "@/lib/storefront/util.store-contact";

interface ContactPageProps {
  params: Promise<{ slug: string }>;
}

export const unstable_dynamicStaleTime = 300;

export const generateMetadata = async ({ params }: ContactPageProps): Promise<Metadata> => {
  const { slug } = await params;
  const [store, t, locale] = await Promise.all([
    getStoreBySlug(slug),
    getTranslations("storefront.contact"),
    getLocale(),
  ]);

  if (!store) {
    return {};
  }

  return generateStoreMetadata(
    {
      id: store.id,
      name: store.name,
      slug: store.slug,
      settings: store.settings,
      theme: store.theme,
    },
    {
      title: t("metaTitle", { name: store.name }),
      description: t("metaDescription", { name: store.name }),
      path: "/contact",
      locale,
    },
  );
};

/**
 * How to reach the store, in the shape chosen in the dashboard: `full`
 * lists every channel beside the form; `message` leads with the form and
 * keeps the email as a footnote; `single` makes one channel the page's one
 * big action. The map and opening hours close every shape.
 */
const ContactPage = async ({ params }: ContactPageProps) => {
  const { slug } = await params;
  const [store, t] = await Promise.all([
    getStoreBySlug(slug),
    getTranslations("storefront.contact"),
  ]);

  if (!store) {
    notFound();
  }

  const channels = resolveStoreContactChannels(store);
  const hasRows = store.address !== null || hasStoreContactChannels(channels);
  const asideProps = {
    name: store.name,
    address: store.address,
    latitude: store.latitude,
    longitude: store.longitude,
    businessHours: store.settings?.businessHours,
    timezone: store.settings?.timezone,
  };

  const header = (
    <div>
      <BackLink href="/" />
      <SectionHeader
        level="h1"
        title={t("title", { name: store.name })}
        description={channels.intro ?? t("intro")}
        className="mt-2 mb-0"
      />
    </div>
  );

  const form = channels.form ? (
    <section aria-labelledby="contact-form-title" className="flex flex-col gap-4">
      <SectionHeader
        id="contact-form-title"
        level="h2"
        title={t("formTitle")}
        description={t("formDescription")}
        className="mb-0"
      />
      <ContactForm
        storeSlug={store.slug}
        storeName={store.name}
        phoneField={channels.form.phoneField}
      />
    </section>
  ) : null;

  if (channels.layout === "single" && channels.primary) {
    return (
      <>
        <JsonLd data={[generateLocalBusinessSchema(store)]} />
        <StorefrontSection width="narrow" contentClassName="flex flex-col gap-8 sm:gap-10">
          {header}
          <ContactPrimaryAction action={channels.primary} />
          {form}
        </StorefrontSection>
        <StorefrontSection spacing="tight" contentClassName="pb-8">
          <ContactAside {...asideProps} direction="row" />
        </StorefrontSection>
      </>
    );
  }

  if (channels.layout === "message" && channels.form) {
    return (
      <>
        <JsonLd data={[generateLocalBusinessSchema(store)]} />
        <StorefrontSection width="narrow" contentClassName="flex flex-col gap-8 sm:gap-10">
          {header}
          {form}
          {channels.email ? (
            <p className="text-sm text-muted-foreground">
              {t("orEmail")}{" "}
              <a
                href={`mailto:${channels.email}`}
                className="font-medium text-foreground underline underline-offset-4 hover:opacity-70"
              >
                {channels.email}
              </a>
            </p>
          ) : null}
        </StorefrontSection>
        <StorefrontSection spacing="tight" contentClassName="pb-8">
          <ContactAside {...asideProps} direction="row" />
        </StorefrontSection>
      </>
    );
  }

  return (
    <>
      <JsonLd data={[generateLocalBusinessSchema(store)]} />
      <StorefrontSection contentClassName="flex flex-col gap-8 sm:gap-10">
        {header}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-12">
          <div className="flex flex-col gap-8">
            {hasRows ? (
              <section aria-labelledby="contact-channels-title">
                <SectionHeader
                  id="contact-channels-title"
                  level="h2"
                  title={t("channelsTitle")}
                  className="mb-2"
                />
                <StoreContactDetails
                  address={store.address}
                  phone={channels.phone}
                  sms={channels.sms}
                  whatsapp={channels.whatsapp}
                  email={channels.email}
                />
              </section>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noChannels")}</p>
            )}
            <ContactAside {...asideProps} direction="column" />
          </div>
          {form}
        </div>
      </StorefrontSection>
    </>
  );
};

export default ContactPage;
