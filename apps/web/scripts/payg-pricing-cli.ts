// Shared by the pay-as-you-go pricing audit and freeze scripts. Targets
// MIGRATE_DATABASE_URL only and never loads a .env file, so the scripts cannot hit a
// database by accident.
import mysql, { type RowDataPacket } from "mysql2/promise";

import type { PayAsYouGoConfig } from "@louez/types";

import { parsePayAsYouGoConfig } from "../lib/pay-as-you-go/config";
import type { LegacyPricingTerms } from "../lib/pay-as-you-go/pricing-lock";
import { LEGACY_PAY_AS_YOU_GO_CONFIG } from "../lib/pay-as-you-go/pricing-lock-core";

export const PRICING_OPTIONS = {
  pricing: { type: "string" },
  "free-reservations": { type: "string" },
} as const;

export const PRICING_USAGE = `  --pricing=<json>|builtin  What stores without a stored config pay today: the deployment's
                            PAYG_DEFAULT_PRICING JSON, or "builtin" when it is empty.
  --free-reservations=<n>   The deployment's PAYG_FREE_RESERVATIONS (15 when unset).`;

export function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

/** The legacy terms passed on the command line. Both flags are required on purpose. */
export function readPricingTerms(values: {
  pricing?: string;
  "free-reservations"?: string;
}): LegacyPricingTerms {
  if (!values.pricing) fail("--pricing is required (a JSON offer, or builtin).");
  const offer: PayAsYouGoConfig | null =
    values.pricing === "builtin" ? LEGACY_PAY_AS_YOU_GO_CONFIG : parsePayAsYouGoConfig(values.pricing);
  if (!offer) fail(`--pricing is not a valid pay-as-you-go config: ${values.pricing}`);

  const raw = values["free-reservations"]?.trim();
  if (raw === undefined) fail("--free-reservations is required.");
  if (!/^\d+$/.test(raw)) {
    fail(`--free-reservations must be a whole number >= 0 (15 when the env value is unset), got "${raw}"`);
  }
  return { offer, freeReservations: Number(raw) };
}

/** The script's own arguments: pnpm forwards the `--` separator of `pnpm <script> -- <args>`. */
export function scriptArgs(): string[] {
  return process.argv.slice(2).filter((arg) => arg !== "--");
}

/** The connection URL with its password hidden, for logs. */
function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "****";
    return parsed.toString();
  } catch {
    return "(unparseable URL)";
  }
}

/** Connect to MIGRATE_DATABASE_URL and check it is a Louez database. */
export async function connectTarget(): Promise<mysql.Connection> {
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) fail("Set MIGRATE_DATABASE_URL to the target database (no .env file is read).");
  console.log("🎯 Target:", maskUrl(url));

  const connection = await mysql.createConnection(url);
  const [[info]] = await connection.query<RowDataPacket[]>("SELECT DATABASE() AS d, VERSION() AS v");
  console.log(`🗄️  Database "${info.d}" (MySQL ${info.v})`);
  const [[tables]] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('stores', 'subscriptions', 'platform_fee')`,
  );
  if (Number(tables.n) !== 3) {
    await connection.end();
    fail("No stores/subscriptions/platform_fee tables here: wrong database?");
  }
  return connection;
}

/** Short human summary of a pricing config, in cents. */
export function describePricing(config: PayAsYouGoConfig | null | undefined): string {
  if (!config) return "none";
  if (typeof config.flatRateCents === "number") return `flat ${config.flatRateCents}c`;
  return (config.tiers ?? [])
    .map((tier) => `${tier.priceCents}c${tier.upToCount === null ? "+" : `≤${tier.upToCount}`}`)
    .join(" / ");
}
