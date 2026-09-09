import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getLocale, getTranslations } from "next-intl/server";

import { LegalPageShell } from "@/components/storefront/shell/legal-page-shell";
import { LegalSection } from "@/components/storefront/shell/legal-section";
import { RichText } from "@/components/storefront/ui/rich-text";
import { getInstanceConfig } from "@/lib/deployment";
import { generateStoreMetadata } from "@/lib/seo";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { hasRichTextContent } from "@/lib/util.rich-text";

interface LegalNoticePageProps {
  params: Promise<{ slug: string }>;
}

export const unstable_dynamicStaleTime = 300;

export const generateMetadata = async ({ params }: LegalNoticePageProps): Promise<Metadata> => {
  const { slug } = await params;
  const [store, t, locale] = await Promise.all([
    getStoreBySlug(slug),
    getTranslations("storefront.legal"),
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
      title: `${t("legalNotice.title")} - ${store.name}`,
      description: t("legalNotice.metaDescription", { name: store.name }),
      path: "/legal",
      locale,
    },
  );
};

const LegalNoticePage = async ({ params }: LegalNoticePageProps) => {
  const { slug } = await params;
  const [store, t] = await Promise.all([getStoreBySlug(slug), getTranslations("storefront.legal")]);

  if (!store) {
    notFound();
  }

  // The platform hosting line only holds on the hosted platform; a
  // standalone instance is hosted by whoever runs it.
  const showHosting = !getInstanceConfig().standalone;
  const contactLink = store.email ? (
    <a
      href={`mailto:${store.email}`}
      className="font-medium text-foreground underline underline-offset-4"
    >
      {store.email}
    </a>
  ) : (
    t("personalData.siteManager")
  );

  return (
    <LegalPageShell title={t("legalNotice.title")}>
      <LegalSection title={t("legalNotice.editorInfo")}>
        {hasRichTextContent(store.legalNotice) ? (
          <RichText html={store.legalNotice} />
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="font-medium text-foreground">{t("legalNotice.companyName")}</dt>
            <dd>{store.name}</dd>
            {store.address ? (
              <>
                <dt className="font-medium text-foreground">{t("legalNotice.headquarters")}</dt>
                <dd className="whitespace-pre-line">{store.address}</dd>
              </>
            ) : null}
            {store.email ? (
              <>
                <dt className="font-medium text-foreground">{t("legalNotice.email")}</dt>
                <dd>
                  <a href={`mailto:${store.email}`} className="underline underline-offset-4">
                    {store.email}
                  </a>
                </dd>
              </>
            ) : null}
            {store.phone ? (
              <>
                <dt className="font-medium text-foreground">{t("legalNotice.phone")}</dt>
                <dd>
                  <a href={`tel:${store.phone}`} className="underline underline-offset-4">
                    {store.phone}
                  </a>
                </dd>
              </>
            ) : null}
          </dl>
        )}
      </LegalSection>

      {showHosting ? (
        <LegalSection title={t("hosting.title")}>
          <p>{t("hosting.description")}</p>
        </LegalSection>
      ) : null}

      <LegalSection title={t("intellectualProperty.title")}>
        <p>{t("intellectualProperty.content1", { name: store.name })}</p>
        <p>{t("intellectualProperty.content2", { name: store.name })}</p>
      </LegalSection>

      <LegalSection title={t("personalData.title")}>
        <p>{t("personalData.content1", { name: store.name })}</p>
        <p>
          {t("personalData.content2")} {contactLink}.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
};

export default LegalNoticePage;
