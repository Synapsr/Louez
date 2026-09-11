import { z } from "zod";

/**
 * The activity log is written for the store. This keeps the rows a customer
 * may see (their own actions, the store's decisions, money movements,
 * inspections) and drops the rest (internal notes, access links, Stripe
 * plumbing). Newest first.
 */

export interface ReservationActivityRow {
  id: string;
  activityType: string;
  description?: string | null;
  metadata: unknown;
  createdAt: Date;
}

export type ReservationUpdatePaymentType =
  | "rental"
  | "deposit"
  | "deposit_return"
  | "damage"
  | "adjustment";

export type ReservationUpdate = { id: string; at: Date } & (
  | {
      kind:
        | "created"
        | "confirmed"
        | "picked_up"
        | "returned"
        | "quote_accepted"
        | "quote_declined"
        | "deposit_released"
        | "deposit_failed"
        | "payment_failed"
        | "inspection_departure_completed"
        | "inspection_return_completed"
        | "inspection_signed"
        | "return_date_requested";
    }
  | { kind: "rejected"; reason: string | null }
  | { kind: "cancelled"; byCustomer: boolean }
  | { kind: "payment_received" | "deposit_authorized" | "refunded"; amount: number | null }
  | { kind: "deposit_captured"; amount: number | null; reason: string | null }
  | { kind: "payment_added"; paymentType: ReservationUpdatePaymentType; amount: number | null }
  | { kind: "modified"; startDate: Date | null; endDate: Date | null }
  | { kind: "extension_confirmed"; endDate: Date }
  | { kind: "inspection_damage_detected"; description: string | null; estimatedCost: number | null }
);

const money = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === "number" ? value : Number.parseFloat(value)))
  .pipe(z.number().finite())
  .nullable()
  .catch(null);

const optionalText = z.string().trim().min(1).nullable().catch(null);

const isoDate = z
  .string()
  .transform((value) => new Date(value))
  .pipe(z.date())
  .nullable()
  .catch(null);

const amountSchema = z.object({ amount: money.default(null) }).catch({ amount: null });
const captureSchema = z
  .object({
    amount: money.default(null),
    capturedAmount: money.default(null),
    reason: optionalText.default(null),
  })
  .catch({ amount: null, capturedAmount: null, reason: null });
const refundSchema = z.object({ refundAmount: money.default(null) }).catch({ refundAmount: null });
const rejectionSchema = z.object({ reason: optionalText.default(null) }).catch({ reason: null });
const cancellationSchema = z
  .object({ source: z.string().nullable().default(null) })
  .catch({ source: null });
const manualPaymentSchema = z.object({
  type: z.enum(["rental", "deposit", "deposit_return", "damage", "adjustment"]),
  amount: money.default(null),
});
const modificationSchema = z
  .object({
    previous: z.object({ startDate: isoDate, endDate: isoDate }).partial(),
    updated: z.object({ startDate: isoDate, endDate: isoDate }).partial(),
  })
  .partial();
const extensionSchema = z.object({
  kind: z.literal("rental_extension"),
  status: z.string(),
  requestedEndMs: z.number().finite(),
});
const dateRequestSchema = z.object({ kind: z.literal("return_date_request") });
const damageSchema = z
  .object({
    description: optionalText.default(null),
    estimatedCost: money.default(null),
  })
  .catch({ description: null, estimatedCost: null });

const sameInstant = (a: Date | null | undefined, b: Date | null | undefined) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

const toUpdate = (row: ReservationActivityRow): ReservationUpdate | null => {
  const base = { id: row.id, at: row.createdAt };
  switch (row.activityType) {
    case "created":
    case "confirmed":
    case "picked_up":
    case "returned":
    case "quote_accepted":
    case "quote_declined":
    case "deposit_released":
    case "deposit_failed":
    case "payment_failed":
    case "inspection_departure_completed":
    case "inspection_return_completed":
    case "inspection_signed":
      return { ...base, kind: row.activityType };
    case "rejected": {
      const { reason } = rejectionSchema.parse(row.metadata);
      return { ...base, kind: "rejected", reason: reason ?? (row.description?.trim() || null) };
    }
    case "cancelled": {
      const { source } = cancellationSchema.parse(row.metadata);
      return { ...base, kind: "cancelled", byCustomer: source === "customer_request_cancellation" };
    }
    case "payment_received":
    case "deposit_authorized":
      return { ...base, kind: row.activityType, amount: amountSchema.parse(row.metadata).amount };
    case "deposit_captured": {
      const capture = captureSchema.parse(row.metadata);
      return {
        ...base,
        kind: "deposit_captured",
        amount: capture.capturedAmount ?? capture.amount,
        reason: capture.reason,
      };
    }
    case "payment_updated": {
      const { refundAmount } = refundSchema.parse(row.metadata);
      return refundAmount !== null && refundAmount > 0
        ? { ...base, kind: "refunded", amount: refundAmount }
        : null;
    }
    case "payment_added": {
      const parsed = manualPaymentSchema.safeParse(row.metadata);
      return parsed.success
        ? {
            ...base,
            kind: "payment_added",
            paymentType: parsed.data.type,
            amount: parsed.data.amount,
          }
        : null;
    }
    case "modified": {
      const extension = extensionSchema.safeParse(row.metadata);
      if (extension.success) {
        return extension.data.status === "confirmed"
          ? {
              ...base,
              kind: "extension_confirmed",
              endDate: new Date(extension.data.requestedEndMs),
            }
          : null;
      }
      const change = modificationSchema.safeParse(row.metadata);
      const updated = change.success ? change.data.updated : undefined;
      const previous = change.success ? change.data.previous : undefined;
      const periodChanged =
        !sameInstant(previous?.startDate, updated?.startDate) ||
        !sameInstant(previous?.endDate, updated?.endDate);
      return {
        ...base,
        kind: "modified",
        startDate: periodChanged ? (updated?.startDate ?? null) : null,
        endDate: periodChanged ? (updated?.endDate ?? null) : null,
      };
    }
    case "note_updated":
      return dateRequestSchema.safeParse(row.metadata).success
        ? { ...base, kind: "return_date_requested" }
        : null;
    case "inspection_damage_detected": {
      const damage = damageSchema.parse(row.metadata);
      return {
        ...base,
        kind: "inspection_damage_detected",
        description: damage.description,
        estimatedCost: damage.estimatedCost,
      };
    }
    default:
      return null;
  }
};

export const getReservationUpdates = (
  rows: readonly ReservationActivityRow[],
): ReservationUpdate[] =>
  rows
    .flatMap((row) => {
      const update = toUpdate(row);
      return update ? [update] : [];
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
