"use client";

import { useTranslations } from "next-intl";

import { Input, Select, SelectTrigger, SelectValue } from "@louez/ui";

import { SocialLinksInput } from "@/components/dashboard/customers/social-links-input";

import type { CustomerProfileFieldKey } from "./customer-fields.types";

interface CustomerProfileFieldPreviewProps {
  field: CustomerProfileFieldKey;
  id: string;
}

const ignoreChange = () => undefined;

/** The input the team gets for a native profile field, empty and inert. */
export const CustomerProfileFieldPreview = ({ field, id }: CustomerProfileFieldPreviewProps) => {
  const t = useTranslations("dashboard.customers.form");

  if (field === "birthDate") {
    return <Input id={id} type="date" className="@md/canvas:max-w-48" />;
  }
  if (field === "acquisitionSource") {
    return (
      <Select items={[]} value={null}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={t("acquisitionSourcePlaceholder")} />
        </SelectTrigger>
      </Select>
    );
  }
  return <SocialLinksInput value={{}} onChange={ignoreChange} />;
};
