"use client";

import { useState } from "react";

import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  CUSTOMER_ACQUISITION_SOURCES,
  CUSTOMER_SOCIAL_NETWORKS,
  type CustomerAcquisitionSource,
  type CustomerFieldValues,
  type CustomerProfileSettings,
} from "@louez/types";
import { toastManager } from "@louez/ui";
import { resolveCustomerSocialLinks } from "@louez/utils";
import {
  type CustomerFieldIssueCode,
  type CustomerSectionInput,
  isPlausibleBirthDate,
  isPossiblePhoneNumberInput,
} from "@louez/validations";
import { z } from "zod";

import type { SocialLinksDraft } from "@/components/dashboard/customers/social-links-input";
import { useAppForm } from "@/hooks/form/form";
import { getErrorMessageKey } from "@/lib/utils/util.error-message";

import { updateCustomerSection } from "../actions";
import type { CustomerRecord, CustomerRecordSection } from "./customer-record.types";

export interface CustomerSectionFormValues {
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  socialLinks: SocialLinksDraft;
  birthDate: string;
  acquisitionSource: CustomerAcquisitionSource | "";
  acquisitionSourceDetail: string;
  customFields: CustomerFieldValues;
}

interface UseCustomerSectionFormParams {
  customer: CustomerRecord;
  section: CustomerRecordSection;
  /** Ids of the custom fields the section holds. */
  fieldIds: string[];
  customFields: CustomerFieldValues;
  profileSettings: CustomerProfileSettings;
  onSaved: () => void;
}

/** Only what the open card holds is sent: the rest of the record is not this form's business. */
const toSectionInput = (
  section: CustomerRecordSection,
  values: CustomerSectionFormValues,
  fieldIds: string[],
): CustomerSectionInput => {
  if (section.kind === "contact") {
    return {
      email: values.email,
      phone: values.phone,
      address: values.address,
      city: values.city,
      postalCode: values.postalCode,
      country: values.country || undefined,
      socialLinks: values.socialLinks,
    };
  }
  if (section.kind === "profile") {
    return {
      birthDate: values.birthDate,
      acquisitionSource: values.acquisitionSource || null,
      acquisitionSourceDetail: values.acquisitionSourceDetail,
    };
  }
  return {
    customFields: Object.fromEntries(fieldIds.map((id) => [id, values.customFields[id] ?? ""])),
  };
};

export const useCustomerSectionForm = ({
  customer,
  section,
  fieldIds,
  customFields,
  profileSettings,
  onSaved,
}: UseCustomerSectionFormParams) => {
  const router = useRouter();
  const t = useTranslations("dashboard.customers.detail");
  const tValidation = useTranslations("validation");
  const tErrors = useTranslations("errors");
  const [rootError, setRootError] = useState<string | null>(null);
  const [fieldIssues, setFieldIssues] = useState<Record<string, CustomerFieldIssueCode>>({});

  const schema = z
    .object({
      email: z.union([z.email(tValidation("email")), z.literal("")]),
      phone: z
        .string()
        .refine((value) => value === "" || isPossiblePhoneNumberInput(value), tValidation("phone")),
      address: z.string(),
      city: z.string(),
      postalCode: z.string(),
      country: z.string(),
      socialLinks: z.partialRecord(z.enum(CUSTOMER_SOCIAL_NETWORKS), z.string().max(255)),
      birthDate: z
        .string()
        .refine((value) => value === "" || isPlausibleBirthDate(value), tValidation("date")),
      acquisitionSource: z.union([z.enum(CUSTOMER_ACQUISITION_SOURCES), z.literal("")]),
      acquisitionSourceDetail: z.string().max(255),
      customFields: z.record(z.string(), z.string()),
    })
    .superRefine((values, ctx) => {
      if (section.kind === "contact" && values.email.trim() === "" && values.phone.trim() === "") {
        ctx.addIssue({ code: "custom", message: tValidation("contactRequired"), path: ["email"] });
      }
      if (section.kind !== "profile") return;
      if (profileSettings.birthDate === "required" && values.birthDate === "") {
        ctx.addIssue({ code: "custom", message: tValidation("required"), path: ["birthDate"] });
      }
      if (profileSettings.acquisitionSource === "required" && values.acquisitionSource === "") {
        ctx.addIssue({
          code: "custom",
          message: tValidation("required"),
          path: ["acquisitionSource"],
        });
      }
    });

  const save = useMutation({
    mutationFn: (values: CustomerSectionFormValues) =>
      updateCustomerSection(customer.id, toSectionInput(section, values, fieldIds)),
  });

  const defaultValues: CustomerSectionFormValues = {
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    address: customer.address ?? "",
    city: customer.city ?? "",
    postalCode: customer.postalCode ?? "",
    country: customer.country ?? "",
    socialLinks: Object.fromEntries(
      resolveCustomerSocialLinks(customer.socialLinks).map(({ network, value }) => [
        network,
        value,
      ]),
    ),
    birthDate: customer.birthDate ?? "",
    acquisitionSource: customer.acquisitionSource ?? "",
    acquisitionSourceDetail: customer.acquisitionSourceDetail ?? "",
    customFields,
  };

  const form = useAppForm({
    defaultValues,
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setRootError(null);
      setFieldIssues({});
      const result = await save.mutateAsync(value);

      if ("error" in result && result.error) {
        if ("fieldIssues" in result && result.fieldIssues) {
          setFieldIssues(
            Object.fromEntries(result.fieldIssues.map((issue) => [issue.definitionId, issue.code])),
          );
        }
        const key = getErrorMessageKey(result.error);
        setRootError(tErrors.has(key) ? tErrors(key) : tErrors("generic"));
        return;
      }

      toastManager.add({ title: t("sectionSaved"), type: "success" });
      router.refresh();
      onSaved();
    },
  });

  return { form, rootError, fieldIssues };
};

export type CustomerSectionFormApi = ReturnType<typeof useCustomerSectionForm>["form"];
