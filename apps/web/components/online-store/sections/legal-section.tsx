"use client";

import { useState } from "react";

import { useLocale, useTranslations } from "next-intl";

import { Button, Tabs, TabsList, TabsPanel, TabsTab, toastManager } from "@louez/ui";
import { AccentSparklesIcon, ExternalLinkIcon } from "@louez/ui/icons";

import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { withForm } from "@/hooks/form/form";
import { useStorefrontUrl } from "@/hooks/use-storefront-url";
import { getCgvTemplate, getLegalNoticeTemplate } from "@/lib/legal-templates";

import { PanelGroup } from "../panel/panel-group";
import { PanelSwitchRow } from "../panel/panel-switch-row";
import {
  MAX_FOOTER_NOTE_LENGTH,
  onlineStoreFormOptions,
  onlineStoreSectionProps,
} from "../util.online-store-form";
import type { OnlineStoreSectionProps } from "./online-store-section.types";

type LegalTab = "cgv" | "legal";

const PAGE_PATHS: Record<LegalTab, string> = {
  cgv: "/terms",
  legal: "/legal",
};

/**
 * Terms and legal notice in one editor with a tab per page, the contract
 * option, the footer note. The template fills the open tab; its disclaimer
 * comes with the confirmation, when it matters.
 */
export const LegalSection = withForm({
  ...onlineStoreFormOptions,
  props: onlineStoreSectionProps<OnlineStoreSectionProps>(),
  render: ({ form, store }) => {
    const locale = useLocale();
    const t = useTranslations("dashboard.settings.legalSettings");
    const tOnline = useTranslations("dashboard.onlineStore.legal");
    const { getAbsoluteUrl } = useStorefrontUrl(store.slug);
    const [activeTab, setActiveTab] = useState<LegalTab>("cgv");

    const applyTemplate = () => {
      if (activeTab === "cgv") {
        form.setFieldValue("legal.cgv", getCgvTemplate(locale));
      } else {
        form.setFieldValue("legal.legalNotice", getLegalNoticeTemplate(locale));
      }
      toastManager.add({
        title: t("templateApplied"),
        description: t("templatesDisclaimer"),
        type: "success",
      });
    };

    return (
      <>
        <PanelGroup title={tOnline("texts")}>
          <Tabs
            value={activeTab}
            onValueChange={(tab) => setActiveTab(tab === "legal" ? "legal" : "cgv")}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTab value="cgv" className="min-w-0">
                <span className="truncate">{t("cgv")}</span>
              </TabsTab>
              <TabsTab value="legal" className="min-w-0">
                <span className="truncate">{t("legalNotice")}</span>
              </TabsTab>
            </TabsList>

            <TabsPanel value="cgv">
              <form.Field name="legal.cgv">
                {(field) => (
                  <RichTextEditor
                    value={field.state.value}
                    onChange={(value) => field.handleChange(value)}
                    placeholder={t("cgvPlaceholder")}
                    className="min-h-100"
                  />
                )}
              </form.Field>
            </TabsPanel>

            <TabsPanel value="legal">
              <form.Field name="legal.legalNotice">
                {(field) => (
                  <RichTextEditor
                    value={field.state.value}
                    onChange={(value) => field.handleChange(value)}
                    placeholder={t("legalNoticePlaceholder")}
                    className="min-h-100"
                  />
                )}
              </form.Field>
            </TabsPanel>
          </Tabs>

          <div className="-mt-1 flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={applyTemplate}>
              <AccentSparklesIcon aria-hidden className="size-4 text-primary" />
              {t("useTemplate")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              render={
                <a
                  href={getAbsoluteUrl(PAGE_PATHS[activeTab])}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              {t("viewOnStore")}
              <ExternalLinkIcon aria-hidden className="size-3.5" />
            </Button>
          </div>
        </PanelGroup>

        <PanelGroup title={t("contractPdfSettingsTitle")}>
          <form.Field name="legal.includeFullCgvInContract">
            {(field) => (
              <PanelSwitchRow
                id={field.name}
                label={t("includeFullCgvInContract")}
                helper={t("includeFullCgvInContractHelp")}
                checked={field.state.value}
                onCheckedChange={field.handleChange}
              />
            )}
          </form.Field>
        </PanelGroup>

        <PanelGroup title={tOnline("footerNote.label")}>
          <form.AppField name="legal.footerNote">
            {(field) => (
              <field.Textarea
                aria-label={tOnline("footerNote.label")}
                placeholder={tOnline("footerNote.placeholder")}
                rows={3}
                maxLength={MAX_FOOTER_NOTE_LENGTH}
              />
            )}
          </form.AppField>
        </PanelGroup>
      </>
    );
  },
});
