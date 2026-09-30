"use client";

import { useTranslations } from "next-intl";

import type { CustomerProfileFieldKey } from "@louez/types";
import { Input, Label, Select, SelectTrigger, SelectValue } from "@louez/ui";

import { SocialLinksInput } from "@/components/dashboard/customers/social-links-input";

interface CustomerProfileFieldPreviewProps {
  field: CustomerProfileFieldKey;
  required: boolean;
  id: string;
}

const ignoreChange = () => undefined;

/**
 * A Louez profile field as the team gets it on the customer form, empty and
 * inert, laid out like a store field (label, input, help) so both read alike.
 */
export const CustomerProfileFieldPreview = ({
  field,
  required,
  id,
}: CustomerProfileFieldPreviewProps) => {
  const t = useTranslations("dashboard.settings.customerFields.native");
  const tForm = useTranslations("dashboard.customers.form");
  const label = required ? `${t(field)} *` : t(field);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {field === "socialLinks" ? (
        // A group of links has no single control for a <label> to point at.
        <Label render={<p />}>{label}</Label>
      ) : (
        <Label htmlFor={id}>{label}</Label>
      )}
      {field === "birthDate" && <Input id={id} type="date" className="@md/canvas:max-w-48" />}
      {field === "acquisitionSource" && (
        <Select items={[]} value={null}>
          <SelectTrigger id={id}>
            <SelectValue placeholder={tForm("acquisitionSourcePlaceholder")} />
          </SelectTrigger>
        </Select>
      )}
      {field === "socialLinks" && <SocialLinksInput value={{}} onChange={ignoreChange} />}
      <p className="text-muted-foreground text-sm">{t(`${field}Help`)}</p>
    </div>
  );
};
