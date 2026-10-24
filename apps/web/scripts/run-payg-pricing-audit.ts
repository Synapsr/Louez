/**
 * READ-ONLY audit of what each store was really charged, and of the pricing lock. After
 * a deploy, its summary must show no row without config and no store without a row.
 *
 * Rebuilds each store's charged tariff from `platform_fee` and compares it with the
 * pricing its row holds, or, for a store without a stored config, with the --pricing the
 * freeze would write. Flags stores whose history disagrees (for example a launch offer
 * lost when the configs were reset) and free-reservation anomalies. Runs inside a READ
 * ONLY transaction: it cannot write anything.
 *
 * Production needs Téo's explicit OK. Targets MIGRATE_DATABASE_URL only; no .env file
 * is read.
 *
 * Usage:
 *   MIGRATE_DATABASE_URL="mysql://user:pass@host:port/db" \
 *     pnpm payg:audit-pricing -- \
 *     --pricing='<PAYG_DEFAULT_PRICING json>'|builtin --free-reservations=15 [--json=audit.json]
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import type { RowDataPacket } from "mysql2/promise";

import type { PayAsYouGoConfig } from "@louez/types";

import { resolvePayAsYouGoConfig } from "../lib/pay-as-you-go/config";
import {
  type AuditFeeRow,
  auditAllowance,
  auditStoreFees,
} from "../lib/pay-as-you-go/pricing-audit-core";
import { currencyOfSettings, hasPricingVersionColumn } from "../lib/pay-as-you-go/pricing-lock";
import { normalizeCurrency } from "../lib/pay-as-you-go/pricing-lock-core";
import {
  PRICING_OPTIONS,
  PRICING_USAGE,
  connectTarget,
  describePricing,
  readPricingTerms,
  scriptArgs,
} from "./payg-pricing-cli";

const { values } = parseArgs({
  args: scriptArgs(),
  options: {
    ...PRICING_OPTIONS,
    json: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`Usage: run-payg-pricing-audit.ts [options]\n${PRICING_USAGE}
  --json=<file>             Also write the full report as JSON.`);
  process.exit(0);
}

type Row = Record<string, unknown>;

const asConfig = (value: unknown): PayAsYouGoConfig | null =>
  value === null || value === undefined
    ? null
    : ((typeof value === "string" ? JSON.parse(value) : value) as PayAsYouGoConfig);

const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);

async function main() {
  const terms = readPricingTerms(values);
  const connection = await connectTarget();
  await connection.query("SET SESSION TRANSACTION READ ONLY");
  await connection.query("START TRANSACTION READ ONLY");

  try {
    const query = async (sql: string): Promise<Row[]> =>
      (await connection.query<RowDataPacket[]>(sql))[0];
    const hasVersion = await hasPricingVersionColumn(connection);

    const stores = await query(
      `SELECT st.id, st.slug, st.name, st.created_at, st.settings,
              sub.id AS sub_id, sub.billing_mode, sub.pay_as_you_go_config AS config,
              ${hasVersion ? "sub.pricing_version" : "NULL"} AS pricing_version,
              sub.free_reservations_granted AS free_granted,
              sub.created_at AS sub_created_at, sub.updated_at AS sub_updated_at
       FROM stores st LEFT JOIN subscriptions sub ON sub.store_id = st.id
       ORDER BY st.created_at, st.id`,
    );
    const fees = await query(
      `SELECT store_id, platform_fee_source AS source, platform_fee_status AS status,
              amount_cents, monthly_index, billing_month, currency
       FROM platform_fee ORDER BY billing_month, created_at`,
    );
    const orphanRows = await query(
      `SELECT sub.id, sub.store_id FROM subscriptions sub
       LEFT JOIN stores st ON st.id = sub.store_id WHERE st.id IS NULL`,
    );
    const modeCounts = await query(
      `SELECT billing_mode, pay_as_you_go_config IS NULL AS config_null,
              ${hasVersion ? "pricing_version" : "NULL"} AS pricing_version, COUNT(*) AS n
       FROM subscriptions GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
    );
    // The configuration reset of 2026-07-11 nulled every config with one UPDATE that also
    // set updated_at: rows still sharing that second show when it ran.
    const resetHint = await query(
      `SELECT DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS at, COUNT(*) AS n
       FROM subscriptions WHERE pay_as_you_go_config IS NULL
       GROUP BY 1 HAVING n > 1 ORDER BY n DESC LIMIT 3`,
    );

    const feesByStore = new Map<string, Row[]>();
    for (const fee of fees) {
      const list = feesByStore.get(String(fee.store_id)) ?? [];
      list.push(fee);
      feesByStore.set(String(fee.store_id), list);
    }

    const report = stores.map((store) => {
      const storeId = String(store.id);
      const currency = currencyOfSettings(store.settings);
      const stored = asConfig(store.config);
      const hasRow = store.sub_id !== null && store.sub_id !== undefined;
      const expected = stored ?? terms.offer;
      const storeFees = feesByStore.get(storeId) ?? [];
      const inCurrency: AuditFeeRow[] = [];
      let otherCurrencyRows = 0;
      let freeUsed = 0;
      for (const fee of storeFees) {
        if (fee.source === "free" && fee.status !== "voided") freeUsed++;
        if (normalizeCurrency(String(fee.currency)) !== currency) {
          if (fee.source === "online" || fee.source === "manual") otherCurrencyRows++;
          continue;
        }
        inCurrency.push({
          source: String(fee.source),
          status: String(fee.status),
          amountCents: Number(fee.amount_cents),
          monthlyIndex: fee.monthly_index === null ? null : Number(fee.monthly_index),
          billingMonth: String(fee.billing_month),
        });
      }
      const fees = auditStoreFees(expected, inCurrency);
      const rowCreatedAfterStore =
        hasRow &&
        Math.abs(
          new Date(String(store.sub_created_at)).getTime() -
            new Date(String(store.created_at)).getTime(),
        ) > 10_000;
      const allowance = auditAllowance({
        freeReservationsGranted: hasRow ? Number(store.free_granted) : null,
        freezeFreeReservations: terms.freeReservations,
        freeReservationsUsed: freeUsed,
        rowCreatedAfterStore,
      });
      return {
        storeId,
        slug: String(store.slug),
        name: String(store.name),
        storeCreatedAt: iso(store.created_at),
        currency,
        state: !hasRow ? "no_row" : stored ? "frozen" : "follows_env",
        billingMode: hasRow ? String(store.billing_mode) : null,
        pricingVersion: store.pricing_version ?? null,
        expected: describePricing(resolvePayAsYouGoConfig(expected)),
        freeReservationsGranted: hasRow ? Number(store.free_granted) : null,
        freeReservationsUsed: freeUsed,
        rowCreatedAt: iso(store.sub_created_at),
        rowUpdatedAt: iso(store.sub_updated_at),
        otherCurrencyRows,
        fees,
        allowance,
      };
    });

    console.log("\n── Subscription rows ──");
    for (const row of modeCounts) {
      console.log(
        `   ${String(row.billing_mode).padEnd(14)} config ${Number(row.config_null) ? "NULL    " : "stored  "}` +
          ` version ${String(row.pricing_version ?? "-").padEnd(22)} ${row.n}`,
      );
    }
    console.log(`   stores without a row: ${report.filter((s) => s.state === "no_row").length}`);
    console.log(`   rows whose store is gone: ${orphanRows.length}`);
    if (resetHint.length) {
      console.log("   rows without config sharing one updated_at (likely the 2026-07-11 reset):");
      for (const hint of resetHint) console.log(`     ${hint.at} UTC → ${hint.n} rows`);
    }

    const distinct = new Map<string, number>();
    for (const store of report) {
      if (store.state === "frozen") distinct.set(store.expected, (distinct.get(store.expected) ?? 0) + 1);
    }
    console.log("\n── Stored configs ──");
    for (const [pricing, n] of distinct) console.log(`   ${pricing}: ${n}`);
    console.log(`   freeze value for the others: ${describePricing(resolvePayAsYouGoConfig(terms.offer))}`);

    const flagged = report.filter(
      (store) =>
        store.fees.verdict === "mismatch" ||
        store.allowance.length > 0 ||
        store.otherCurrencyRows > 0 ||
        store.fees.combinedOnlineRows > 0,
    );
    console.log(`\n── Stores to review: ${flagged.length} of ${report.length} ──`);
    for (const store of flagged) {
      console.log(
        `\n• ${store.slug} (${store.storeId}) — ${store.state}, ${store.billingMode ?? "no row"}, created ${store.storeCreatedAt}`,
      );
      console.log(`  expected: ${store.expected}`);
      const f = store.fees;
      if (f.verdict === "mismatch") {
        console.log(
          `  ✖ ${f.mismatchedManual}/${f.manualRows} manual and ${f.mismatchedOnline}/${f.onlineRows} online fees do not fit;` +
            ` charged vs expected on manual fees: ${f.manualDeltaCents >= 0 ? "+" : ""}${f.manualDeltaCents}c`,
        );
        console.log(
          `  charged on manual fees: ${f.observedManualPrices.map((p) => `${p.amountCents}c ×${p.rows} (#${p.fromIndex}-${p.toIndex})`).join(", ") || "none"}`,
        );
        for (const month of f.months.filter((m) => m.mismatched > 0)) {
          console.log(
            `    ${month.billingMonth}: ${month.mismatched}/${month.manualRows + month.onlineRows} off, amounts ${month.observedCents.join("/")}c`,
          );
        }
      }
      if (f.combinedOnlineRows > 0) {
        console.log(
          `  ⓘ ${f.combinedOnlineRows} online fee(s) above the highest expected price: the legacy combined fee, or a higher tariff than expected`,
        );
      }
      if (store.otherCurrencyRows > 0) {
        console.log(`  ⓘ ${store.otherCurrencyRows} fee(s) in another currency than the store's (never invoiced)`);
      }
      for (const note of store.allowance) console.log(`  ⚠ ${note}`);
    }

    const verdicts = { match: 0, mismatch: 0, no_evidence: 0 };
    for (const store of report) verdicts[store.fees.verdict]++;
    console.log(
      `\n── Summary ── match ${verdicts.match}, mismatch ${verdicts.mismatch}, no manual fee to judge ${verdicts.no_evidence}`,
    );

    if (values.json) {
      writeFileSync(
        values.json,
        JSON.stringify(
          { at: new Date().toISOString(), terms, modeCounts, orphanRows, resetHint, stores: report },
          null,
          2,
        ),
      );
      console.log(`📝 Full report written to ${values.json}`);
    }
    console.log("\n✅ Audit complete (read-only, nothing was modified).");
  } finally {
    await connection.query("ROLLBACK");
    await connection.end();
  }
}

main().catch((error) => {
  console.error("❌ Audit failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
