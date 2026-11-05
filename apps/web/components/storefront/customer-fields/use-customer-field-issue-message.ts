"use client";

import { useCallback } from "react";

import { useTranslations } from "next-intl";

import type { CustomerFieldIssueCode } from "@louez/validations";

/**
 * The customer-facing wording of a value the shared rules refuse. "Required"
 * reads like every other checkout field; the others reuse the customer
 * record's messages.
 */
export const useCustomerFieldIssueMessage = () => {
  const tCheckout = useTranslations("storefront.checkout.errors");
  const tIssues = useTranslations("dashboard.customers.fields.issues");

  return useCallback(
    (code: CustomerFieldIssueCode) => (code === "required" ? tCheckout("required") : tIssues(code)),
    [tCheckout, tIssues],
  );
};
