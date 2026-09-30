"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import type { CustomerProfileFieldVisibility, CustomerProfileSettings } from "@louez/types";
import { toastManager } from "@louez/ui";

import { PanelSegmentedControl } from "@/components/online-store/panel/panel-segmented-control";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { orpc } from "@/lib/orpc/react";

interface CustomerNativeFieldsCardProps {
  settings: CustomerProfileSettings;
}

const NATIVE_FIELDS = [
  { key: "birthDate", allowsRequired: true },
  { key: "acquisitionSource", allowsRequired: true },
  { key: "socialLinks", allowsRequired: false },
] as const;

/** The optional blocks Louez ships with: shown, hidden or required, store by store. */
export const CustomerNativeFieldsCard = ({ settings }: CustomerNativeFieldsCardProps) => {
  const t = useTranslations("dashboard.settings.customerFields.native");
  const tErrors = useTranslations("errors");
  const router = useRouter();

  const mutation = useMutation(
    orpc.dashboard.customerFields.updateProfileSettings.mutationOptions({
      onSuccess: () => {
        toastManager.add({ title: t("saved"), type: "success" });
        router.refresh();
      },
      onError: () => toastManager.add({ title: tErrors("generic"), type: "error" }),
    }),
  );

  // The server copy is the source until a change is in flight, then the change is.
  const current = { ...settings, ...mutation.variables };

  return (
    <DashboardSectionCard title={t("title")} description={t("description")}>
      <ul className="divide-y">
        {NATIVE_FIELDS.map(({ key, allowsRequired }) => {
          const visibilities: CustomerProfileFieldVisibility[] = allowsRequired
            ? ["hidden", "optional", "required"]
            : ["hidden", "optional"];
          return (
            <li
              key={key}
              className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{t(key)}</p>
                <p className="text-muted-foreground text-sm">{t(`${key}Help`)}</p>
              </div>
              <div className="shrink-0 sm:w-72">
                <PanelSegmentedControl
                  aria-label={t(key)}
                  value={current[key] ?? "optional"}
                  options={visibilities.map((visibility) => ({
                    value: visibility,
                    label: t(`visibility.${visibility}`),
                  }))}
                  onChange={(visibility) => {
                    if (visibility === "required" && !allowsRequired) return;
                    mutation.mutate({ [key]: visibility });
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </DashboardSectionCard>
  );
};
