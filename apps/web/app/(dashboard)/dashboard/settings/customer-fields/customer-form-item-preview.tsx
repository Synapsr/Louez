"use client";

import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition, CustomerFormBuiltInKey } from "@louez/types";

import {
  CustomerFormInputPreview,
  type CustomerFormInputPreviewKind,
} from "./customer-form-input-preview";

type PreviewDefinition = Pick<CustomerFieldDefinition, "type" | "unit" | "helpText">;

interface CustomerFormItemPreviewProps {
  /** A Louez field by its key, or one of the store's by what it holds. */
  field:
    | { kind: "builtin"; key: CustomerFormBuiltInKey }
    | { kind: "custom"; definition: PreviewDefinition };
}

const CUSTOM_KINDS: Record<PreviewDefinition["type"], CustomerFormInputPreviewKind> = {
  text: "text",
  textarea: "textarea",
  number: "text",
  date: "date",
  select: "select",
  checkbox: "switch",
  phone: "text",
  email: "text",
  url: "text",
};

/** An item's input as the customer form shows it, empty, with its help line when it has one. */
export const CustomerFormItemPreview = ({ field }: CustomerFormItemPreviewProps) => {
  const t = useTranslations("dashboard.customers");
  const tBuilder = useTranslations("dashboard.settings.customerFields.builder");

  if (field.kind === "custom") {
    const { definition } = field;
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <CustomerFormInputPreview
          kind={CUSTOM_KINDS[definition.type]}
          placeholder={definition.type === "select" ? t("fields.selectPlaceholder") : undefined}
          unit={definition.type === "number" ? definition.unit : null}
        />
        {definition.helpText && (
          <p className="text-muted-foreground truncate text-xs">{definition.helpText}</p>
        )}
      </div>
    );
  }

  switch (field.key) {
    case "firstName":
    case "lastName":
    case "email":
    case "phone":
    case "companyName":
    case "companyNumber":
    case "vatNumber":
      return (
        <CustomerFormInputPreview kind="text" placeholder={t(`form.${field.key}Placeholder`)} />
      );
    case "address":
      return (
        <CustomerFormInputPreview kind="text" placeholder={tBuilder("locked.addressPlaceholder")} />
      );
    case "birthDate":
      return <CustomerFormInputPreview kind="date" />;
    case "acquisitionSource":
      return (
        <CustomerFormInputPreview
          kind="select"
          placeholder={t("form.acquisitionSourcePlaceholder")}
        />
      );
    case "socialLinks":
      return <CustomerFormInputPreview kind="button" placeholder={t("social.add")} />;
  }
};
