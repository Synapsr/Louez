"use client";

import { useTranslations } from "next-intl";

import {
  resolveCustomerFieldTemplates,
  suggestCustomerFieldTemplates,
} from "@/lib/customers/customer-field-templates";

import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";

/**
 * The templates in the merchant's language, the two or three that fit this
 * store (its country, its activity), and which ones are already in.
 */
export const useCustomerFieldTemplates = () => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { fields, settings } = useCustomerFieldsBuilder();

  const templates = resolveCustomerFieldTemplates((key) => t(`templates.${key}`));
  const adoptedKeys = new Set(fields.map((field) => field.key));
  const suggestions = suggestCustomerFieldTemplates({
    templates,
    country: settings.country,
    productCategory: settings.productCategory,
    adoptedKeys,
  });

  return {
    templates,
    adoptedKeys,
    suggestions,
    /** The gallery opens on the store's country when one of its templates is suggested. */
    defaultGroup: suggestions.some((template) => template.group === "country")
      ? ("country" as const)
      : ("general" as const),
  };
};
