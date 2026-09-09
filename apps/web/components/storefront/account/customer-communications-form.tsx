"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toastManager } from "@louez/ui";
import { useAppForm } from "@/hooks/form/form";
import { customerProfileMutations } from "@/lib/queries/customer-profile.queries";
import type { CustomerReminderPreferences } from "@/lib/notifications/util.customer-reminder-preferences";

export const CustomerCommunicationsForm = ({
  storeSlug,
  preferences,
}: {
  storeSlug: string;
  preferences: CustomerReminderPreferences;
}) => {
  const t = useTranslations();
  const router = useRouter();
  const save = useMutation({
    ...customerProfileMutations.communications(),
    onSuccess: (result) => {
      toastManager.add({
        title: t(
          result.ok ? "storefront.account.profile.saved" : "storefront.account.profile.saveError",
        ),
        type: result.ok ? "success" : "error",
      });
      if (result.ok) router.refresh();
    },
    onError: () => {
      toastManager.add({ title: t("storefront.account.profile.saveError"), type: "error" });
    },
  });
  const form = useAppForm({
    defaultValues: preferences,
    onSubmit: async ({ value }) => {
      await save.mutateAsync({ storeSlug, ...value }).catch(() => undefined);
    },
  });
  return (
    <section className="border-t pt-6">
      <h2 className="text-xl font-semibold">{t("storefront.account.communications.title")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("storefront.account.communications.description")}
      </p>
      <form.AppForm>
        <form.Form className="mt-4 flex flex-col gap-4">
          <form.AppField name="emailReminders">
            {(field) => <field.Switch label={t("storefront.account.communications.email")} />}
          </form.AppField>
          <form.AppField name="smsReminders">
            {(field) => <field.Switch label={t("storefront.account.communications.sms")} />}
          </form.AppField>
          <p className="text-sm text-muted-foreground">
            {t("storefront.account.communications.essential")}
          </p>
          <form.SubscribeButton type="submit" className="self-start">
            {t("common.save")}
          </form.SubscribeButton>
        </form.Form>
      </form.AppForm>
    </section>
  );
};
