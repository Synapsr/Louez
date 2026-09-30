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
  type ResolvedCustomerProfileSettings,
  type CustomerSocialNetwork,
} from "@louez/types";
import {
  type CustomerFieldIssueCode,
  type CustomerInput,
  isPlausibleBirthDate,
  isPossiblePhoneNumberInput,
} from "@louez/validations";
import { resolveCustomerSocialLinks } from "@louez/utils";
import { z } from "zod";

import { useAppForm } from "@/hooks/form/form";
import { trackOpenReplayEvent } from "@/lib/openreplay/client";
import { openReplayEvents } from "@/lib/openreplay/events";
import { getErrorMessageKey } from "@/lib/utils/util.error-message";

import { createCustomer, updateCustomer } from "./actions";
import type { CustomerFormCustomer, CustomerFormOpenReplaySource } from "./customer-form.types";

export interface CustomerFormValues {
  customerType: "individual" | "business";
  email: string;
  firstName: string;
  lastName: string;
  companyName: string;
  companyNumber: string;
  vatNumber: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  birthDate: string;
  acquisitionSource: CustomerAcquisitionSource | "";
  acquisitionSourceDetail: string;
  socialLinks: Partial<Record<CustomerSocialNetwork, string>>;
  notes: string;
  customFields: CustomerFieldValues;
}

interface UseCustomerFormParams {
  customer?: CustomerFormCustomer;
  initialCustomFields: CustomerFieldValues;
  profileSettings: ResolvedCustomerProfileSettings;
  openReplaySource: CustomerFormOpenReplaySource;
}

const blankToUndefined = (value: string) => (value.trim() === "" ? undefined : value);

/** What the server action expects: blanks dropped rather than sent as empty strings. */
const toCustomerInput = (values: CustomerFormValues): CustomerInput => ({
  ...values,
  companyName: blankToUndefined(values.companyName),
  companyNumber: blankToUndefined(values.companyNumber),
  vatNumber: blankToUndefined(values.vatNumber),
  phone: blankToUndefined(values.phone),
  address: blankToUndefined(values.address),
  city: blankToUndefined(values.city),
  postalCode: blankToUndefined(values.postalCode),
  country: blankToUndefined(values.country),
  birthDate: blankToUndefined(values.birthDate),
  acquisitionSource: values.acquisitionSource || undefined,
  acquisitionSourceDetail: blankToUndefined(values.acquisitionSourceDetail),
  notes: blankToUndefined(values.notes),
});

export const useCustomerForm = ({
  customer,
  initialCustomFields,
  profileSettings,
  openReplaySource,
}: UseCustomerFormParams) => {
  const router = useRouter();
  const tValidation = useTranslations("validation");
  const tErrors = useTranslations("errors");
  const [rootError, setRootError] = useState<string | null>(null);
  const [fieldIssues, setFieldIssues] = useState<Record<string, CustomerFieldIssueCode>>({});
  const isEditing = customer !== undefined;

  // The form holds strings, blank when empty; the server schema takes it from there.
  const schema = z
    .object({
      customerType: z.enum(["individual", "business"]),
      email: z.email(tValidation("email")),
      firstName: z.string().trim().min(1, tValidation("required")).max(255),
      lastName: z.string().trim().min(1, tValidation("required")).max(255),
      companyName: z.string().max(255),
      companyNumber: z.string().max(64),
      vatNumber: z.string().max(64),
      phone: z
        .string()
        .refine((value) => value === "" || isPossiblePhoneNumberInput(value), tValidation("phone")),
      address: z.string(),
      city: z.string(),
      postalCode: z.string(),
      country: z.string().refine((value) => value === "" || value.length === 2),
      birthDate: z
        .string()
        .refine((value) => value === "" || isPlausibleBirthDate(value), tValidation("date")),
      acquisitionSource: z.union([z.enum(CUSTOMER_ACQUISITION_SOURCES), z.literal("")]),
      acquisitionSourceDetail: z.string().max(255),
      socialLinks: z.partialRecord(z.enum(CUSTOMER_SOCIAL_NETWORKS), z.string().max(255)),
      notes: z.string(),
      customFields: z.record(z.string(), z.string()),
    })
    .superRefine((values, ctx) => {
      if (values.customerType === "business" && values.companyName.trim() === "") {
        ctx.addIssue({
          code: "custom",
          message: tValidation("companyNameRequired"),
          path: ["companyName"],
        });
      }
      if (profileSettings.birthDate.visibility === "required" && values.birthDate === "") {
        ctx.addIssue({ code: "custom", message: tValidation("required"), path: ["birthDate"] });
      }
      if (
        profileSettings.acquisitionSource.visibility === "required" &&
        values.acquisitionSource === ""
      ) {
        ctx.addIssue({
          code: "custom",
          message: tValidation("required"),
          path: ["acquisitionSource"],
        });
      }
    });

  const save = useMutation({
    mutationFn: async (values: CustomerFormValues) => {
      const input = toCustomerInput(values);
      return isEditing ? updateCustomer(customer.id, input) : createCustomer(input);
    },
  });

  const form = useAppForm({
    defaultValues: {
      customerType: customer?.customerType ?? "individual",
      email: customer?.email ?? "",
      firstName: customer?.firstName ?? "",
      lastName: customer?.lastName ?? "",
      companyName: customer?.companyName ?? "",
      companyNumber: customer?.companyNumber ?? "",
      vatNumber: customer?.vatNumber ?? "",
      phone: customer?.phone ?? "",
      address: customer?.address ?? "",
      city: customer?.city ?? "",
      postalCode: customer?.postalCode ?? "",
      country: customer?.country ?? "",
      birthDate: customer?.birthDate ?? "",
      acquisitionSource: customer?.acquisitionSource ?? "",
      acquisitionSourceDetail: customer?.acquisitionSourceDetail ?? "",
      socialLinks: Object.fromEntries(
        resolveCustomerSocialLinks(customer?.socialLinks).map(({ network, value }) => [
          network,
          value,
        ]),
      ),
      notes: customer?.notes ?? "",
      customFields: initialCustomFields,
    } satisfies CustomerFormValues,
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

      if (!isEditing) {
        trackOpenReplayEvent(openReplayEvents.dashboardCustomerCreationCompleted, {
          journey: "customer_creation",
          step: "completed",
          source: openReplaySource,
        });
      }

      const createdId = "customerId" in result ? result.customerId : undefined;
      router.push(`/dashboard/customers/${isEditing ? customer.id : (createdId ?? "")}`);
    },
  });

  return { form, rootError, fieldIssues, isEditing };
};

export type CustomerFormApi = ReturnType<typeof useCustomerForm>["form"];
