import {
  createLoader,
  createSerializer,
  parseAsFloat,
  parseAsInteger,
  parseAsNumberLiteral,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server";

import { DEFAULT_FINANCE_PERIOD, FINANCE_PERIODS, PAYMENT_MOVEMENT_NATURES } from "@louez/utils";
import type { PaymentMovementNature } from "@louez/utils";
import {
  DEFAULT_FINANCE_PAGE_SIZE,
  FINANCE_MOVEMENT_DIRECTIONS,
  FINANCE_MOVEMENT_STATUSES,
  FINANCE_PAGE_SIZES,
  FINANCE_PAYMENT_METHODS,
} from "@louez/validations";
import type { FinanceMovementStatus, FinancePaymentMethod } from "@louez/validations";

import type { DashboardAccent } from "@/components/dashboard/shared/dashboard-accent";

export const FINANCES_PATH = "/dashboard/finances";

export const FINANCE_TABS = ["movements", "outstanding", "deposits"] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number];

/**
 * The whole screen lives in the URL, so a shared link opens the same view. The
 * parsers come from `nuqs/server`: the page reads them on the server, the
 * content component on the client, and both normalise a value the same way.
 */
export const financeSearchParams = {
  period: parseAsStringLiteral(FINANCE_PERIODS).withDefault(DEFAULT_FINANCE_PERIOD),
  from: parseAsString,
  to: parseAsString,
  tab: parseAsStringLiteral(FINANCE_TABS).withDefault("movements"),
  direction: parseAsStringLiteral(FINANCE_MOVEMENT_DIRECTIONS),
  method: parseAsStringLiteral(FINANCE_PAYMENT_METHODS),
  nature: parseAsStringLiteral(PAYMENT_MOVEMENT_NATURES),
  status: parseAsStringLiteral(FINANCE_MOVEMENT_STATUSES),
  min: parseAsFloat,
  max: parseAsFloat,
  q: parseAsString,
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsNumberLiteral(FINANCE_PAGE_SIZES).withDefault(DEFAULT_FINANCE_PAGE_SIZE),
  /** Payment shown in the detail sheet. */
  movement: parseAsString,
};

export const loadFinanceSearchParams = createLoader(financeSearchParams);
export const serializeFinanceSearchParams = createSerializer(financeSearchParams);

export const METHOD_ACCENTS: Record<FinancePaymentMethod, DashboardAccent> = {
  stripe: "primary",
  cash: "success",
  card: "progress",
  transfer: "submitted",
  check: "pending",
  other: "neutral",
};

/** Key of a nature's label under `dashboard.finances.nature`. */
export const NATURE_LABEL_KEYS: Record<PaymentMovementNature, string> = {
  rental: "rental",
  deposit: "deposit",
  deposit_hold: "depositHold",
  deposit_capture: "depositCapture",
  deposit_return: "depositReturn",
  refund: "refund",
  damage: "damage",
  adjustment: "adjustment",
};

/** A settled row needs no badge; these are the ones that do. */
export const STATUS_BADGE_VARIANTS: Record<
  Exclude<FinanceMovementStatus, "settled">,
  "pending" | "info" | "failed" | "expired"
> = {
  pending: "pending",
  held: "info",
  failed: "failed",
  cancelled: "expired",
};
