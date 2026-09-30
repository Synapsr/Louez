import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

import { and, eq, inArray, isNull } from "drizzle-orm";

import { pickRefundOriginal, type RefundLinkResult } from "../payment-refund-link";

type CliOptions = {
  apply: boolean;
  storeId?: string;
};

type AmbiguousRefund = {
  refundPaymentId: string;
  reservationId: string;
  type: string;
  amount: string;
  stripeRefundId: string | null;
  reason: Extract<RefundLinkResult, { status: "ambiguous" }>["reason"];
  candidateIds: string[];
};

const RESERVATION_CHUNK_SIZE = 500;

function printUsage(): void {
  console.log(`Usage:
  pnpm payments:link-stripe-refunds -- --dry-run
  pnpm payments:link-stripe-refunds -- --apply
  pnpm payments:link-stripe-refunds -- --apply --store-id <storeId>
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    // pnpm forwards the "--" separator itself on some versions.
    if (arg === "--") continue;
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--store-id") options.storeId = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }

  return options;
}

/** Host and schema only: the report is pasted in tickets, the password is not. */
function describeTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}:${url.port || "3306"}${url.pathname}`;
  } catch {
    return "unparseable DATABASE_URL";
  }
}

/**
 * Points every Stripe refund row at the charge it refunds (`refundOfPaymentId`),
 * which new refunds get from `ensureRefundPaymentRecord`. The cash ledger needs
 * the link to show a refunded charge at its gross amount on the day it was
 * paid. Refunds that could belong to several charges are listed and left
 * untouched; the ledger then keeps their charge at its net amount.
 */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { db, payments, reservations, isStripeRefundPaymentSql } = await import("../index");
  const { env } = await import("../env");

  const refunds = await db
    .select({
      id: payments.id,
      reservationId: payments.reservationId,
      type: payments.type,
      status: payments.status,
      amount: payments.amount,
      stripeChargeId: payments.stripeChargeId,
      stripeRefundId: payments.stripeRefundId,
      stripePaymentIntentId: payments.stripePaymentIntentId,
      stripeCheckoutSessionId: payments.stripeCheckoutSessionId,
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .where(
      and(
        isStripeRefundPaymentSql(),
        isNull(payments.refundOfPaymentId),
        options.storeId ? eq(reservations.storeId, options.storeId) : undefined,
      ),
    );

  const reservationIds = [...new Set(refunds.map((refund) => refund.reservationId))];
  const paymentsByReservation = new Map<string, (typeof refunds)[number][]>();
  for (let index = 0; index < reservationIds.length; index += RESERVATION_CHUNK_SIZE) {
    const rows = await db
      .select({
        id: payments.id,
        reservationId: payments.reservationId,
        type: payments.type,
        status: payments.status,
        amount: payments.amount,
        stripeChargeId: payments.stripeChargeId,
        stripeRefundId: payments.stripeRefundId,
        stripePaymentIntentId: payments.stripePaymentIntentId,
        stripeCheckoutSessionId: payments.stripeCheckoutSessionId,
      })
      .from(payments)
      .where(
        inArray(
          payments.reservationId,
          reservationIds.slice(index, index + RESERVATION_CHUNK_SIZE),
        ),
      );
    for (const row of rows) {
      const siblings = paymentsByReservation.get(row.reservationId) ?? [];
      siblings.push(row);
      paymentsByReservation.set(row.reservationId, siblings);
    }
  }

  const links: { refundPaymentId: string; originalId: string }[] = [];
  const ambiguous: AmbiguousRefund[] = [];
  let linkedByCharge = 0;
  let linkedByReservation = 0;

  for (const refund of refunds) {
    const result = pickRefundOriginal(
      refund,
      paymentsByReservation.get(refund.reservationId) ?? [],
    );
    if (result.status === "linked") {
      links.push({ refundPaymentId: refund.id, originalId: result.originalId });
      if (result.matchedBy === "charge") linkedByCharge += 1;
      else linkedByReservation += 1;
      continue;
    }
    ambiguous.push({
      refundPaymentId: refund.id,
      reservationId: refund.reservationId,
      type: refund.type,
      amount: refund.amount,
      stripeRefundId: refund.stripeRefundId,
      reason: result.reason,
      candidateIds: result.candidateIds,
    });
  }

  if (options.apply && links.length > 0) {
    await db.transaction(async (tx) => {
      for (const link of links) {
        await tx
          .update(payments)
          .set({ refundOfPaymentId: link.originalId })
          // Never overwrite a link written since the scan.
          .where(and(eq(payments.id, link.refundPaymentId), isNull(payments.refundOfPaymentId)));
      }
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? "apply" : "dry-run",
        target: describeTarget(env.DATABASE_URL),
        storeId: options.storeId ?? null,
        refundsScanned: refunds.length,
        linkedByCharge,
        linkedByReservation,
        ambiguousCount: ambiguous.length,
        ambiguous,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
