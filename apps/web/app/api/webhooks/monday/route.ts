import { NextResponse } from "next/server";

import { useLogger, withEvlog } from "@/lib/evlog";
import {
  extractMondayChallenge,
  mondayWebhookPayloadSchema,
  processInboundMondayWebhookEvent,
  verifyMondayWebhookRequest,
} from "@/lib/integrations/monday/webhook";
import { runAfterResponse } from "@/lib/reservations/post-creation-effects";

/**
 * Public webhook endpoint for monday.com status changes (`POST /api/webhooks/monday`).
 *
 * Security & Protocol:
 * 1. Authenticates via `secret` query parameter or `x-monday-webhook-secret` / `Authorization` header
 *    against the store's configured `webhookSecret` in `store_monday_integrations` (or `MONDAY_WEBHOOK_SECRET`).
 * 2. Responds immediately with `{ challenge }` during initial monday.com webhook verification handshake.
 * 3. Responds `200 OK` immediately and offloads GraphQL lookup + DB status mutation to background execution.
 */
async function handleMondayWebhook(request: Request) {
  const logger = useLogger();

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  // Verify webhook secret first (also required during monday.com's initial URL handshake)
  const verification = await verifyMondayWebhookRequest(request);
  if (!verification.authorized) {
    logger.set({
      mondayWebhook: {
        authorized: false,
      },
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Handle monday.com initial webhook challenge handshake immediately
  const challenge = extractMondayChallenge(rawPayload);
  if (challenge) {
    logger.set({
      mondayWebhook: {
        handshake: true,
        matchedStoreId: verification.matchedStoreId,
      },
    });
    return NextResponse.json({ challenge }, { status: 200 });
  }

  const parsed = mondayWebhookPayloadSchema.safeParse(rawPayload);
  if (!parsed.success || !parsed.data.event) {
    return NextResponse.json({ ok: true, ignored: "no_event" }, { status: 200 });
  }

  const event = parsed.data.event;

  logger.set({
    mondayWebhook: {
      authorized: true,
      matchedStoreId: verification.matchedStoreId,
      pulseId: event.pulseId ?? event.itemId ?? null,
      columnId: event.columnId ?? null,
      userId: event.userId ?? null,
    },
  });

  // Return 200 OK immediately and process status change asynchronously
  runAfterResponse(async () => {
    await processInboundMondayWebhookEvent(event, verification.matchedStoreId);
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

export const POST = withEvlog(handleMondayWebhook);
