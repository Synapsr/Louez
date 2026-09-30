"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldScope } from "@louez/types";
import { Button } from "@louez/ui";

import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";

interface CustomerFieldsAddSectionButtonProps {
  scope: CustomerFieldScope;
}

/** "Nouvelle section": appears at the end of its scope with its name ready to type. */
export const CustomerFieldsAddSectionButton = ({ scope }: CustomerFieldsAddSectionButtonProps) => {
  const t = useTranslations("dashboard.settings.customerFields.builder.sections");
  const { addSection } = useCustomerFieldsBuilder();

  return (
    <Button
      type="button"
      variant="outline"
      className="text-muted-foreground w-full justify-start border-dashed bg-transparent shadow-none"
      onClick={() => addSection(scope)}
    >
      <Plus />
      {t("add")}
    </Button>
  );
};
