"use client";

import Link from "next/link";

import { useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition, ResolvedCustomerProfileSettings } from "@louez/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@louez/ui";
import type { CustomerFieldIssueCode } from "@louez/validations";

import { CustomerFieldControl } from "@/components/dashboard/customers/customer-field-control";
import { CustomerProfileFields } from "@/components/dashboard/customers/customer-profile-fields";
import { SocialLinksInput } from "@/components/dashboard/customers/social-links-input";

import { getFieldError } from "@/hooks/form/form-context";
import { groupFieldsBySection } from "@/lib/customers/util.customer-fields";
import { CustomerFormGroup } from "./customer-form-group";
import type { CustomerFormApi } from "./use-customer-form";

interface CustomerFormAdditionalInfoProps {
  form: CustomerFormApi;
  definitions: CustomerFieldDefinition[];
  profileSettings: ResolvedCustomerProfileSettings;
  fieldIssues: Record<string, CustomerFieldIssueCode>;
  customerId?: string;
  canCustomize: boolean;
}

export const CustomerFormAdditionalInfo = ({
  form,
  definitions,
  profileSettings,
  fieldIssues,
  customerId,
  canCustomize,
}: CustomerFormAdditionalInfoProps) => {
  const t = useTranslations("dashboard.customers");
  const customerType = useStore(form.store, (state) => state.values.customerType);
  const customFields = useStore(form.store, (state) => state.values.customFields);
  const socialLinks = useStore(form.store, (state) => state.values.socialLinks);
  const birthDateError = useStore(form.store, (state) => state.fieldMeta.birthDate?.errors?.[0]);
  const sourceError = useStore(
    form.store,
    (state) => state.fieldMeta.acquisitionSource?.errors?.[0],
  );

  const applicable = definitions.filter(
    (definition) => definition.appliesTo === "all" || definition.appliesTo === customerType,
  );
  const sections = groupFieldsBySection(applicable);
  const showProfile =
    profileSettings.birthDate.visibility !== "hidden" ||
    profileSettings.acquisitionSource.visibility !== "hidden";
  const showSocial = profileSettings.socialLinks.visibility !== "hidden";

  if (!showProfile && !showSocial && sections.length === 0 && !canCustomize) return null;

  const profileRequired =
    profileSettings.birthDate.visibility === "required" ||
    profileSettings.acquisitionSource.visibility === "required";
  const socialCount = Object.values(socialLinks).filter(Boolean).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("form.moreInfo")}</CardTitle>
        <CardDescription>{t("form.moreInfoDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {showProfile && (
          <CustomerFormGroup title={t("form.profileSection")} meta="" defaultOpen={profileRequired}>
            <form.Subscribe
              selector={(state) => ({
                birthDate: state.values.birthDate,
                acquisitionSource: state.values.acquisitionSource,
                acquisitionSourceDetail: state.values.acquisitionSourceDetail,
              })}
            >
              {(profile) => (
                <CustomerProfileFields
                  value={profile}
                  settings={profileSettings}
                  errors={{
                    birthDate: birthDateError ? getFieldError(birthDateError) : undefined,
                    acquisitionSource: sourceError ? getFieldError(sourceError) : undefined,
                  }}
                  onChange={(changes) => {
                    if (changes.birthDate !== undefined) {
                      form.setFieldValue("birthDate", changes.birthDate);
                    }
                    if (changes.acquisitionSource !== undefined) {
                      form.setFieldValue("acquisitionSource", changes.acquisitionSource);
                    }
                    if (changes.acquisitionSourceDetail !== undefined) {
                      form.setFieldValue(
                        "acquisitionSourceDetail",
                        changes.acquisitionSourceDetail,
                      );
                    }
                  }}
                />
              )}
            </form.Subscribe>
          </CustomerFormGroup>
        )}

        {showSocial && (
          <CustomerFormGroup
            title={t("form.socialSection")}
            meta={socialCount > 0 ? t("form.filledCount", { count: socialCount }) : ""}
            defaultOpen={socialCount > 0}
          >
            <SocialLinksInput
              value={socialLinks}
              onChange={(links) => form.setFieldValue("socialLinks", links)}
            />
          </CustomerFormGroup>
        )}

        {sections.map((section) => {
          const filled = section.fields.filter((field) => customFields[field.id]).length;
          const hasIssue = section.fields.some((field) => fieldIssues[field.id]);
          return (
            <CustomerFormGroup
              key={section.name}
              title={section.name}
              meta={
                filled > 0
                  ? t("form.filledCount", { count: filled })
                  : t("form.fieldCount", { count: section.fields.length })
              }
              defaultOpen={
                hasIssue || filled > 0 || section.fields.some((field) => field.isRequired)
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {section.fields.map((definition) => (
                  <div
                    key={definition.id}
                    className={
                      definition.type === "textarea" || definition.type === "checkbox"
                        ? "sm:col-span-2"
                        : undefined
                    }
                  >
                    <CustomerFieldControl
                      definition={definition}
                      customerId={customerId}
                      value={customFields[definition.id] ?? ""}
                      error={
                        fieldIssues[definition.id]
                          ? t(`fields.issues.${fieldIssues[definition.id]}`)
                          : undefined
                      }
                      onChange={(value) =>
                        form.setFieldValue("customFields", {
                          ...customFields,
                          [definition.id]: value,
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </CustomerFormGroup>
          );
        })}

        {canCustomize && (
          <Link
            href="/dashboard/settings/customer-fields"
            className="text-muted-foreground hover:text-foreground mt-3 inline-block px-2 text-sm underline underline-offset-2"
          >
            {t("form.customizeFields")}
          </Link>
        )}
      </CardContent>
    </Card>
  );
};
