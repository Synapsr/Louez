"use client";

import { useTranslations } from "next-intl";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@louez/ui";
import { ExternalLinkIcon } from "@louez/ui/icons";
import { ChevronDown } from "lucide-react";

import { withForm } from "@/hooks/form/form";
import { useStorefrontUrl } from "@/hooks/use-storefront-url";

import { LogoUploadField } from "../fields/logo-upload-field";
import { PanelGroup } from "../panel/panel-group";
import { onlineStoreFormOptions, onlineStoreSectionProps } from "../util.online-store-form";
import type { OnlineStoreSectionProps } from "./online-store-section.types";

const SEARCH_CONSOLE_URL = "https://search.google.com/search-console";

/**
 * The share image and Search Console ownership. The owner adds the
 * storefront URL as a property in Search Console, picks the HTML tag method
 * and pastes the tag or its token here; the storefront then renders the
 * verification meta on every page. Those steps stay folded until asked for.
 */
export const SeoSection = withForm({
  ...onlineStoreFormOptions,
  props: onlineStoreSectionProps<OnlineStoreSectionProps>(),
  render: ({ form, uploads, savedValues, store }) => {
    const t = useTranslations("dashboard.settings.seoSettings");
    const tOnline = useTranslations("dashboard.onlineStore.seo");
    const { getAbsoluteUrl } = useStorefrontUrl(store.slug);
    const storefrontUrl = getAbsoluteUrl();

    return (
      <>
        <PanelGroup title={tOnline("shareImage.title")}>
          <form.Field name="seo.shareImageUrl">
            {(field) => (
              <LogoUploadField
                id="share-image-upload"
                kind="hero"
                shape="wide"
                label={tOnline("shareImage.label")}
                helper={`${tOnline("shareImage.description")} ${tOnline("shareImage.fallback")} ${tOnline("shareImage.hint")}`}
                value={field.state.value}
                savedValue={savedValues.seo.shareImageUrl}
                uploads={uploads}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
        </PanelGroup>

        <PanelGroup title={t("verification.title")}>
          <form.AppField name="seo.googleSiteVerification">
            {(field) => (
              <field.Input
                label={t("verification.label")}
                // The placeholder is an HTML tag, which ICU would read as rich text.
                placeholder={t.raw("verification.placeholder")}
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </form.AppField>

          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-1 rounded-md text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {tOnline("verificationHowTo")}
              <ChevronDown
                aria-hidden
                className="size-4 transition-transform group-data-panel-open:rotate-180"
              />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <ol className="list-decimal space-y-1.5 pt-3 pl-5 text-muted-foreground text-sm">
                <li>
                  {t.rich("verification.step1", {
                    link: (chunks) => (
                      <a
                        href={SEARCH_CONSOLE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
                      >
                        {chunks}
                        <ExternalLinkIcon className="size-3.5" />
                      </a>
                    ),
                  })}
                </li>
                <li>
                  {t("verification.step2")}{" "}
                  <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {storefrontUrl}
                  </code>
                </li>
                <li>{t("verification.step3")}</li>
              </ol>
            </CollapsiblePanel>
          </Collapsible>
        </PanelGroup>
      </>
    );
  },
});
