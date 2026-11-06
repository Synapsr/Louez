"use client";

import { ClipboardPaste, FileSpreadsheet, Package, Users } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ImportEntityType } from "@louez/types";

import { InfoCallout } from "@/components/dashboard/info-callout";
import { FormRadioCardGroup } from "@/components/form/form-radio-card-group";

import type { ImportOrigin } from "./import-wizard.types";

interface ImportSourceStepProps {
  entity: ImportEntityType;
  origin: ImportOrigin;
  onEntityChange: (entity: ImportEntityType) => void;
  onOriginChange: (origin: ImportOrigin) => void;
}

export const ImportSourceStep = ({
  entity,
  origin,
  onEntityChange,
  onOriginChange,
}: ImportSourceStepProps) => {
  const t = useTranslations("dashboard.settings.import.source");
  const tProducts = useTranslations("dashboard.settings.import.products");

  return (
    <div className="space-y-6">
      <FormRadioCardGroup
        label={t("title")}
        columns={2}
        value={entity}
        onChange={onEntityChange}
        options={[
          {
            value: "customers",
            label: t("customers"),
            description: t("customersDescription"),
            icon: Users,
          },
          {
            value: "products",
            label: t("products"),
            description: tProducts("sourceDescription"),
            icon: Package,
          },
        ]}
      />
      <FormRadioCardGroup
        label={t("originTitle")}
        columns={2}
        value={origin}
        onChange={onOriginChange}
        options={[
          {
            value: "file",
            label: t("file"),
            description: t("fileDescription"),
            icon: FileSpreadsheet,
          },
          {
            value: "paste",
            label: t("paste"),
            description: t("pasteDescription"),
            icon: ClipboardPaste,
          },
        ]}
      />
      <InfoCallout>{entity === "products" ? tProducts("draftNote") : t("hint")}</InfoCallout>
    </div>
  );
};
