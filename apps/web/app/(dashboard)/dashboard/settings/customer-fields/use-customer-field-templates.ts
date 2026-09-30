"use client";

import { useTranslations } from "next-intl";

import type { CustomerFieldScope } from "@louez/types";

import {
  resolveCustomerFieldTemplates,
  suggestCustomerFieldTemplates,
} from "@/lib/customers/customer-field-templates";

import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { isTemplateAdopted, listFeaturedTemplates } from "./util.customer-field-templates";

/**
 * The templates of one tab in the merchant's language, the ones that fit this
 * store (its country, its activity), and which ones are already in.
 */
export const useCustomerFieldTemplates = (scope: CustomerFieldScope) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { fields, settings } = useCustomerFieldsBuilder();

  const adoptedKeys = new Set(fields.map((field) => field.key));
  const templates = resolveCustomerFieldTemplates((key) => t(`templates.${key}`)).filter(
    (template) => template.scope === scope,
  );
  const suggestions = suggestCustomerFieldTemplates({
    templates,
    country: settings.country,
    productCategory: settings.productCategory,
    adoptedKeys,
  });

  return {
    templates,
    suggestions,
    /** The store's suggestions, else the tab's templates not taken yet: an empty tab's ideas. */
    featured: listFeaturedTemplates({ templates, suggestions, adoptedKeys }),
    isAdopted: (template: (typeof templates)[number]) => isTemplateAdopted(template, adoptedKeys),
  };
};
