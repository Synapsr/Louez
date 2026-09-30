"use client";

import { useState } from "react";

import { Mail, MapPin, Pencil, Phone } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import type {
  CustomerFieldDefinition,
  CustomerFieldValues,
  ResolvedCustomerProfileSettings,
} from "@louez/types";
import { Button } from "@louez/ui";

import { CustomerFieldValue } from "@/components/dashboard/customers/customer-field-value";
import { CustomerSocialLinks } from "@/components/dashboard/customers/customer-social-links";
import { EmailContactPopover } from "@/components/dashboard/email-contact-popover";
import { PhoneContactPopover } from "@/components/dashboard/phone-contact-popover";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { getAgeFromBirthDate } from "@/lib/customers/util.customer-age";
import { groupFieldsBySection } from "@/lib/customers/util.customer-fields";
import { getCountryName } from "@/lib/utils/countries";

import { CustomerRecordRow } from "./customer-record-row";
import type { CustomerRecord, CustomerRecordSection } from "./customer-record.types";
import { CustomerSectionSheet } from "./customer-section-sheet";

interface CustomerRecordSideProps {
  customer: CustomerRecord;
  definitions: CustomerFieldDefinition[];
  customFields: CustomerFieldValues;
  profileSettings: ResolvedCustomerProfileSettings;
  storeCountry: string;
  locale: string;
  /** Landing demos: the record is shown, never edited. */
  readOnly?: boolean;
}

const sectionKey = (section: CustomerRecordSection) =>
  section.kind === "custom" ? `custom:${section.name}` : section.kind;

export const CustomerRecordSide = ({
  customer,
  definitions,
  customFields,
  profileSettings,
  storeCountry,
  locale,
  readOnly = false,
}: CustomerRecordSideProps) => {
  const t = useTranslations("dashboard.customers");
  const format = useFormatter();
  const [editing, setEditing] = useState<CustomerRecordSection | null>(null);

  const sections = groupFieldsBySection(
    definitions.filter(
      (definition) =>
        definition.appliesTo === "all" || definition.appliesTo === customer.customerType,
    ),
  );
  const showProfile =
    profileSettings.birthDate.visibility !== "hidden" ||
    profileSettings.acquisitionSource.visibility !== "hidden";
  const age = customer.birthDate ? getAgeFromBirthDate(customer.birthDate) : null;
  const hasProfile = Boolean(customer.birthDate || customer.acquisitionSource);

  const editButton = (section: CustomerRecordSection, label: string) =>
    readOnly ? undefined : (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t("detail.editSection", { section: label })}
      onClick={() => setEditing(section)}
    >
      <Pencil className="size-3.5" />
    </Button>
  );

  const editingFields =
    editing?.kind === "custom"
      ? (sections.find((section) => section.name === editing.name)?.fields ?? [])
      : [];
  const editingTitle =
    editing?.kind === "custom"
      ? editing.name
      : editing?.kind === "profile"
        ? t("detail.profileCard")
        : t("detail.contactCard");

  return (
    <div className="min-w-0 space-y-4">
      <DashboardSectionCard
        title={t("detail.contactCard")}
        action={editButton({ kind: "contact" }, t("detail.contactCard"))}
      >
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-3">
            <Mail className="text-muted-foreground size-4 shrink-0" />
            <EmailContactPopover email={customer.email} disabled={readOnly} />
          </div>
          <div className="flex items-center gap-3">
            <Phone className="text-muted-foreground size-4 shrink-0" />
            {customer.phone ? (
              <PhoneContactPopover phone={customer.phone} disabled={readOnly} />
            ) : (
              <span className="text-muted-foreground">{t("detail.noPhone")}</span>
            )}
          </div>
          <div className="flex items-start gap-3">
            <MapPin className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            {customer.address || customer.city ? (
              <div>
                {customer.address && <p>{customer.address}</p>}
                <p>{[customer.postalCode, customer.city].filter(Boolean).join(" ")}</p>
                {customer.country && customer.country !== storeCountry && (
                  <p className="text-muted-foreground">
                    {getCountryName(customer.country, locale)}
                  </p>
                )}
              </div>
            ) : (
              <span className="text-muted-foreground">{t("detail.noAddress")}</span>
            )}
          </div>
          {profileSettings.socialLinks.visibility !== "hidden" && (
            <CustomerSocialLinks
              links={customer.socialLinks}
              getOpenLabel={(network) => t("social.open", { network })}
            />
          )}
        </div>
      </DashboardSectionCard>

      {showProfile && (
        <DashboardSectionCard
          title={t("detail.profileCard")}
          action={editButton({ kind: "profile" }, t("detail.profileCard"))}
        >
          {hasProfile ? (
            <dl className="space-y-2.5">
              {customer.birthDate && (
                <CustomerRecordRow label={t("form.birthDate")}>
                  {format.dateTime(new Date(`${customer.birthDate}T00:00:00`), {
                    dateStyle: "long",
                  })}
                  {age !== null && (
                    <span className="text-muted-foreground">
                      {" · "}
                      {t("form.ageYears", { age })}
                    </span>
                  )}
                </CustomerRecordRow>
              )}
              {customer.acquisitionSource && (
                <CustomerRecordRow label={t("detail.source")}>
                  {t(`sources.${customer.acquisitionSource}`)}
                  {customer.acquisitionSourceDetail && (
                    <span className="text-muted-foreground block">
                      {customer.acquisitionSourceDetail}
                    </span>
                  )}
                </CustomerRecordRow>
              )}
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">{t("detail.emptyProfile")}</p>
          )}
        </DashboardSectionCard>
      )}

      {sections.map((section) => {
        const filled = section.fields.filter((field) => customFields[field.id]);
        const missing = section.fields.length - filled.length;
        return (
          <DashboardSectionCard
            key={section.name}
            title={section.name}
            action={editButton({ kind: "custom", name: section.name }, section.name)}
          >
            <div className="space-y-3">
              {filled.length > 0 && (
                <dl className="space-y-2.5">
                  {filled.map((definition) => (
                    <CustomerRecordRow key={definition.id} label={definition.label}>
                      <CustomerFieldValue
                        definition={definition}
                        value={customFields[definition.id] ?? ""}
                      />
                    </CustomerRecordRow>
                  ))}
                </dl>
              )}
              {missing > 0 && !readOnly && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => setEditing({ kind: "custom", name: section.name })}
                >
                  {t("fields.complete", { count: missing })}
                </Button>
              )}
            </div>
          </DashboardSectionCard>
        );
      })}

      {editing && (
        <CustomerSectionSheet
          key={sectionKey(editing)}
          customer={customer}
          section={editing}
          title={editingTitle}
          fields={editingFields}
          customFields={customFields}
          profileSettings={profileSettings}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
};
