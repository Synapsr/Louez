"use client";

import Link from "next/link";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { useDebounce } from "@/hooks/use-debounce";
import { orpc } from "@/lib/orpc/react";

interface CustomerSimilarHintProps {
  email: string;
  phone: string;
  lastName: string;
  /** The record being edited, left out of the lookup. */
  customerId?: string;
}

/**
 * Warns while a customer is being entered that the store may already know
 * them. Without an e-mail, nothing else would catch the second record.
 */
export const CustomerSimilarHint = ({
  email,
  phone,
  lastName,
  customerId,
}: CustomerSimilarHintProps) => {
  const t = useTranslations("dashboard.customers.similar");
  const input = useDebounce(
    { email: email.trim(), phone: phone.trim(), lastName: lastName.trim() },
    400,
  );
  const canSearch = Boolean(input.email || (input.phone && input.lastName));

  const { data } = useQuery(
    orpc.dashboard.customers.findSimilar.queryOptions({
      input: {
        email: input.email || undefined,
        phone: input.phone || undefined,
        lastName: input.lastName || undefined,
        excludeCustomerId: customerId,
      },
      enabled: canSearch,
    }),
  );

  const match = canSearch ? data?.[0] : undefined;
  if (!match) return null;

  const name = match.companyName ?? `${match.firstName} ${match.lastName}`;
  return (
    <p className="text-badge-warning-foreground text-sm">
      {t("found", { name })}{" "}
      <Link
        href={`/dashboard/customers/${match.id}`}
        target="_blank"
        className="underline underline-offset-2"
      >
        {t("view")}
      </Link>
    </p>
  );
};
