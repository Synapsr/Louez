import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FileTextIcon } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { Button } from "@louez/ui";

import { LegalPageShell } from "@/components/storefront/shell/legal-page-shell";
import { LegalSection } from "@/components/storefront/shell/legal-section";
import { EmptyState } from "@/components/storefront/ui/empty-state";
import { RichText } from "@/components/storefront/ui/rich-text";
import { generateStoreMetadata } from "@/lib/seo";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { hasRichTextContent } from "@/lib/util.rich-text";

interface TermsPageProps {
  params: Promise<{ slug: string }>;
}

export const unstable_dynamicStaleTime = 300;

export const generateMetadata = async ({ params }: TermsPageProps): Promise<Metadata> => {
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
      title: `${t("cgv.title")} - ${store.name}`,
      description: t("cgv.metaDescription", { name: store.name }),
      path: "/terms",
      locale,
    },
  );
};

const TermsPage = async ({ params }: TermsPageProps) => {
  const { slug } = await params;
  const [store, t] = await Promise.all([getStoreBySlug(slug), getTranslations("storefront.legal")]);

  if (!store) {
    notFound();
  }

  const hasContact = Boolean(store.email || store.phone || store.address);

  return (
    <LegalPageShell title={t("cgv.title")}>
      {hasRichTextContent(store.cgv) ? (
        <RichText html={store.cgv} />
      ) : (
        <EmptyState
          tone="card"
          icon={<FileTextIcon />}
          title={t("cgv.noCgv")}
          description={t("cgv.contactSeller")}
          action={
            store.email ? (
              <Button variant="outline" render={<a href={`mailto:${store.email}`} />}>
                {t("contact")}
              </Button>
            ) : undefined
          }
        />
      )}

      {hasContact ? (
        <LegalSection title={t("contact")}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
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
            {store.address ? (
              <>
                <dt className="font-medium text-foreground">{t("legalNotice.address")}</dt>
                <dd className="whitespace-pre-line">{store.address}</dd>
              </>
            ) : null}
          </dl>
        </LegalSection>
      ) : null}
    </LegalPageShell>
  );
};

export default TermsPage;
