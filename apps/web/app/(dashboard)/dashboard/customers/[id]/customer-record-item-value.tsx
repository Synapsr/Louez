"use client";

import { useFormatter, useTranslations } from "next-intl";

import type { CustomerFieldValues } from "@louez/types";
import type { CustomerFormLayoutItem } from "@louez/validations";

import { CustomerFieldValue } from "@/components/dashboard/customers/customer-field-value";
import { CustomerSocialLinks } from "@/components/dashboard/customers/customer-social-links";
import { EmailContactPopover } from "@/components/dashboard/email-contact-popover";
import { PhoneContactPopover } from "@/components/dashboard/phone-contact-popover";
import { getAgeFromBirthDate } from "@/lib/customers/util.customer-age";
import { getCountryName } from "@/lib/utils/countries";

import type { CustomerRecord } from "./customer-record.types";

interface CustomerRecordItemValueProps {
  item: CustomerFormLayoutItem;
  customer: CustomerRecord;
  customFields: CustomerFieldValues;
  /** The store's country: an address there does not repeat it. */
  storeCountry: string;
  locale: string;
  /** Landing demos: nothing opens. */
  readOnly: boolean;
}

/** What the record holds for one item of the layout, as a person reads it. */
export const CustomerRecordItemValue = ({
  item,
  customer,
  customFields,
  storeCountry,
  locale,
  readOnly,
}: CustomerRecordItemValueProps) => {
  const t = useTranslations("dashboard.customers");
  const format = useFormatter();

  if (item.kind === "custom") {
    return (
      <CustomerFieldValue
        definition={item.definition}
        value={customFields[item.definition.id] ?? ""}
      />
    );
  }

  switch (item.key) {
    case "email":
      return <EmailContactPopover email={customer.email} disabled={readOnly} />;
    case "phone":
      return customer.phone ? (
        <PhoneContactPopover phone={customer.phone} disabled={readOnly} />
      ) : null;
    case "address":
      return (
        <>
          {customer.address && <span className="block">{customer.address}</span>}
          <span className="block">
            {[customer.postalCode, customer.city].filter(Boolean).join(" ")}
          </span>
          {customer.country && customer.country !== storeCountry && (
            <span className="text-muted-foreground block">
              {getCountryName(customer.country, locale)}
            </span>
          )}
        </>
      );
    case "birthDate": {
      if (!customer.birthDate) return null;
      const age = getAgeFromBirthDate(customer.birthDate);
      return (
        <>
          {format.dateTime(new Date(`${customer.birthDate}T00:00:00`), { dateStyle: "long" })}
          {age !== null && (
            <span className="text-muted-foreground">
              {" · "}
              {t("form.ageYears", { age })}
            </span>
          )}
        </>
      );
    }
    case "acquisitionSource":
      return customer.acquisitionSource ? (
        <>
          {t(`sources.${customer.acquisitionSource}`)}
          {customer.acquisitionSourceDetail && (
            <span className="text-muted-foreground block">{customer.acquisitionSourceDetail}</span>
          )}
        </>
      ) : null;
    case "socialLinks":
      return (
        <span className="flex justify-end">
          <CustomerSocialLinks
            links={customer.socialLinks}
            getOpenLabel={(network) => t("social.open", { network })}
          />
        </span>
      );
    default:
      return <span className="break-words">{customer[item.key]}</span>;
  }
};
