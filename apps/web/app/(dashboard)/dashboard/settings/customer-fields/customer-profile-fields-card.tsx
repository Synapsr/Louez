"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Card, toastManager } from "@louez/ui";

import { orpc } from "@/lib/orpc/react";

import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import type { CustomerProfileFieldKey } from "./customer-fields.types";
import { CustomerProfileFieldRow } from "./customer-profile-field-row";
import { toProfileSettingsPatch } from "./util.customer-fields-builder";

const NATIVE_FIELDS: readonly { key: CustomerProfileFieldKey; allowsRequired: boolean }[] = [
  { key: "birthDate", allowsRequired: true },
  { key: "acquisitionSource", allowsRequired: true },
  { key: "socialLinks", allowsRequired: false },
];

/** "Profil": the optional fields Louez ships with, shown, hidden or required, store by store. */
export const CustomerProfileFieldsCard = () => {
  const t = useTranslations("dashboard.settings.customerFields");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const { settings } = useCustomerFieldsBuilder();

  const mutation = useMutation(
    orpc.dashboard.customerFields.updateProfileSettings.mutationOptions({
      onSuccess: () => {
        toastManager.add({ title: t("native.saved"), type: "success" });
        router.refresh();
      },
      onError: () => toastManager.add({ title: tErrors("generic"), type: "error" }),
    }),
  );

  // The server copy is the source until a change is in flight, then the change is.
  const current = { ...settings.profileSettings, ...mutation.variables };

  return (
    <Card className="gap-1 p-3 sm:p-4">
      <div className="flex flex-col gap-0.5 ps-1">
        <h3 className="text-base font-semibold leading-snug">{t("builder.profile.title")}</h3>
        <p className="text-muted-foreground text-sm">{t("builder.profile.description")}</p>
      </div>
      <div className="flex flex-col">
        {NATIVE_FIELDS.map(({ key, allowsRequired }) => (
          <CustomerProfileFieldRow
            key={key}
            field={key}
            visibility={current[key] ?? "optional"}
            allowsRequired={allowsRequired}
            onChange={(visibility) => {
              const patch = toProfileSettingsPatch(key, visibility);
              if (patch) mutation.mutate(patch);
            }}
          />
        ))}
      </div>
    </Card>
  );
};
