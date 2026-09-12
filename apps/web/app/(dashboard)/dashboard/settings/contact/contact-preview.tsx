"use client";

import { useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@louez/ui";

import { withForm } from "@/hooks/form/form";

import { ContactPageSketch } from "./contact-page-sketch";
import {
  type ContactSettingsStore,
  contactSectionProps,
  contactSettingsFormOptions,
} from "./util.contact-settings-form";

interface ContactPreviewProps {
  store: ContactSettingsStore;
}

/** The sketch of the contact page, redrawn from the form as it is being edited. */
export const ContactPreview = withForm({
  ...contactSettingsFormOptions,
  props: contactSectionProps<ContactPreviewProps>(),
  render: ({ form, store }) => {
    const t = useTranslations("dashboard.settings.contactSettings");
    const values = useStore(form.store, (state) => state.values);

    return (
      <Card className="lg:sticky lg:top-6">
        <CardHeader>
          <CardTitle>{t("preview")}</CardTitle>
          <CardDescription>{t("previewHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ContactPageSketch store={store} values={values} />
        </CardContent>
      </Card>
    );
  },
});
