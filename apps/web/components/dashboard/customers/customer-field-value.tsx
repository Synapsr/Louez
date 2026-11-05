"use client";

import { useFormatter, useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";
import { formatIdentityValue } from "@louez/validations";

import { EmailContactPopover } from "@/components/dashboard/email-contact-popover";
import { PhoneContactPopover } from "@/components/dashboard/phone-contact-popover";
import { CopyButton } from "@/components/ui/copy-button";
import { MaskedValue } from "@/components/ui/masked-value";

interface CustomerFieldValueProps {
  definition: Pick<CustomerFieldDefinition, "type" | "format" | "unit" | "isSensitive">;
  value: string;
}

/** One stored custom value as a person reads it on the customer record. */
export const CustomerFieldValue = ({ definition, value }: CustomerFieldValueProps) => {
  const t = useTranslations("dashboard.customers.fields");
  const format = useFormatter();

  if (definition.type === "checkbox") return <span>{value === "true" ? t("yes") : t("no")}</span>;

  if (definition.type === "date") {
    return <span>{format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "long" })}</span>;
  }

  if (definition.type === "phone") return <PhoneContactPopover phone={value} />;
  if (definition.type === "email") return <EmailContactPopover email={value} />;

  if (definition.type === "url") {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="truncate underline underline-offset-2"
      >
        {value.replace(/^https?:\/\//, "")}
      </a>
    );
  }

  const display =
    definition.type === "number" && Number.isFinite(Number(value))
      ? format.number(Number(value))
      : definition.format
        ? formatIdentityValue(definition.format, value)
        : value;
  const withUnit = definition.unit ? `${display} ${definition.unit}` : display;

  if (definition.isSensitive) {
    return (
      <span className="inline-flex min-w-0 items-center">
        <MaskedValue value={withUnit} revealLabel={t("reveal")} hideLabel={t("hide")} />
        <CopyButton value={value} size="icon-xs" />
      </span>
    );
  }

  return (
    <span className={definition.type === "textarea" ? "whitespace-pre-wrap" : "truncate"}>
      {withUnit}
    </span>
  );
};
