import { eq } from "drizzle-orm";
import { z } from "zod";

import { billingSyncState, db } from "@louez/db";

import { log as evlog } from "@/lib/evlog";

import { readSyncState } from "@/lib/billing-sync/state";

// Billing sync alerts (plan decision 13): every alert is an Evlog error; the first
// alert of a kind in an hour also goes to the admin Discord channel. The last send
// time per kind lives in billing_sync_state.alerts, so several instances share it.

export type BillingAlertKind =
  | "relay_stale"
  | "relay_auth"
  | "relay_contract"
  | "relay_single_event_mode"
  | "event_dead"
  | "event_too_large"
  | "event_limit"
  | "rows_failing"
  | "response_invalid"
  | "clock_skew"
  | "policies_invalid"
  | "policies_conflict"
  | "policies_stale"
  | "manifest_rejected";

export type BillingLog = {
  error(tag: string, message: string): void;
  info(tag: string, message: string): void;
};

export type BillingAlerts = {
  readonly log: BillingLog;
  /** Logs the alert and, at most once an hour per kind, posts it to Discord. Never throws. */
  alert(kind: BillingAlertKind, message: string): Promise<void>;
};

const DISCORD_INTERVAL_MS = 60 * 60 * 1000;
const sentAt = z.record(z.string(), z.string()).catch({});

async function notifyDiscord(kind: BillingAlertKind, message: string): Promise<void> {
  const { notifyBillingAlert } = await import("@/lib/discord/platform-notifications");
  await notifyBillingAlert(kind, message);
}

/** Claims the Discord slot of `kind`: true when no message went out in the last hour. */
async function claimDiscordSlot(kind: BillingAlertKind, now: Date): Promise<boolean> {
  await readSyncState();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ alerts: billingSyncState.alerts })
      .from(billingSyncState)
      .where(eq(billingSyncState.id, 1))
      .for("update");
    const alerts = sentAt.parse(row?.alerts ?? {});
    const last = alerts[kind] ? Date.parse(alerts[kind]) : Number.NaN;
    if (!Number.isNaN(last) && now.getTime() - last < DISCORD_INTERVAL_MS) return false;
    await tx
      .update(billingSyncState)
      .set({ alerts: { ...alerts, [kind]: now.toISOString() } })
      .where(eq(billingSyncState.id, 1));
    return true;
  });
}

export function createBillingAlerts(
  options: {
    readonly log?: BillingLog;
    readonly notify?: (kind: BillingAlertKind, message: string) => Promise<void>;
  } = {},
): BillingAlerts {
  const log = options.log ?? evlog;
  const notify = options.notify ?? notifyDiscord;
  return {
    log,
    async alert(kind, message) {
      log.error("billing", `billing sync alert ${kind}: ${message}`);
      try {
        if (await claimDiscordSlot(kind, new Date())) await notify(kind, message);
      } catch (error) {
        log.error(
          "billing",
          `billing sync alert ${kind} could not reach Discord: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
