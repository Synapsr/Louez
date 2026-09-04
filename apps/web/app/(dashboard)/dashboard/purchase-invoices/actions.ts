"use server";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { log } from "@/lib/evlog";
import { pollSuperPdpInvoiceEvents } from "@/lib/invoicing/superpdp-events";
import {
  acceptReceivedInvoice,
  acknowledgeReceivedInvoice,
  refuseReceivedInvoice,
} from "@/lib/invoicing/superpdp-received";
import { currentUserHasPermission, getCurrentStore } from "@/lib/store-context";

const PURCHASE_INVOICES_PATH = "/dashboard/purchase-invoices";

const acknowledgeInputSchema = z.object({
  receivedInvoiceId: z.string().length(21),
});

const refuseInputSchema = acknowledgeInputSchema.extend({
  // Free text forwarded to the PDP network, so it is bounded and trimmed here.
  reason: z.string().trim().max(500).optional(),
});

export type ReceivedInvoiceActionResult =
  | { status: "success" }
  | {
      status: "error";
      /** Translation key under the `errors` namespace. */
      error: string;
    };

/**
 * Every lifecycle statement goes through here: the store is resolved from the
 * session (never from the client), the caller must be able to write, and the
 * provider identifier stays server-side.
 */
async function runReceivedInvoiceAction(
  action: "accept" | "acknowledge" | "refuse",
  input: { receivedInvoiceId: string; reason?: string },
): Promise<ReceivedInvoiceActionResult> {
  const store = await getCurrentStore();
  if (!store) {
    return { status: "error", error: "errors.unauthorized" };
  }

  const canWrite = await currentUserHasPermission("write");
  if (!canWrite) {
    return { status: "error", error: "errors.forbidden" };
  }

  try {
    const payload = { receivedInvoiceId: input.receivedInvoiceId, storeId: store.id };

    if (action === "acknowledge") {
      await acknowledgeReceivedInvoice(payload);
    } else if (action === "accept") {
      await acceptReceivedInvoice(payload);
    } else {
      await refuseReceivedInvoice({ ...payload, reason: input.reason });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log.error("superpdp", `Received invoice ${action} failed for store ${store.id}: ${message}`);

    return { status: "error", error: "errors.generic" };
  }

  revalidatePath(PURCHASE_INVOICES_PATH);
  return { status: "success" };
}

/** Post `fr:204` — the store confirms it received the supplier invoice. */
export async function acknowledgePurchaseInvoice(
  receivedInvoiceId: string,
): Promise<ReceivedInvoiceActionResult> {
  const validated = acknowledgeInputSchema.safeParse({ receivedInvoiceId });
  if (!validated.success) {
    return { status: "error", error: "errors.invalidData" };
  }

  return runReceivedInvoiceAction("acknowledge", validated.data);
}

/** Post `fr:205` — the store accepts the supplier invoice. Legally binding. */
export async function acceptPurchaseInvoice(
  receivedInvoiceId: string,
): Promise<ReceivedInvoiceActionResult> {
  const validated = acknowledgeInputSchema.safeParse({ receivedInvoiceId });
  if (!validated.success) {
    return { status: "error", error: "errors.invalidData" };
  }

  return runReceivedInvoiceAction("accept", validated.data);
}

/** Post `fr:210` — the store refuses the supplier invoice. Legally binding. */
export async function refusePurchaseInvoice(
  receivedInvoiceId: string,
  reason?: string,
): Promise<ReceivedInvoiceActionResult> {
  const validated = refuseInputSchema.safeParse({ reason, receivedInvoiceId });
  if (!validated.success) {
    return { status: "error", error: "errors.invalidData" };
  }

  return runReceivedInvoiceAction("refuse", {
    reason: validated.data.reason || undefined,
    receivedInvoiceId: validated.data.receivedInvoiceId,
  });
}

export async function syncPurchaseInvoices(): Promise<ReceivedInvoiceActionResult> {
  const store = await getCurrentStore();
  const canWrite = await currentUserHasPermission("write");
  if (!store || !canWrite) return { status: "error", error: "unauthorized" };

  try {
    await pollSuperPdpInvoiceEvents();
  } catch (error) {
    log.error(
      "superpdp",
      `manual inbox sync failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { status: "error", error: "generic" };
  }

  revalidatePath(PURCHASE_INVOICES_PATH);
  revalidatePath("/dashboard/settings/invoicing");
  return { status: "success" };
}
