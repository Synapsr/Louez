import type { ApiEffectSenders, EffectSendContext } from "@louez/api/platform/effects";
import { db, isDemoStore } from "@louez/db";

type AnySender = (
  payload: unknown,
  context: EffectSendContext,
) => ReturnType<ApiEffectSenders[keyof ApiEffectSenders]>;

/**
 * The outbox senders, each skipping the rows of a demo store (lib/demo): a
 * demo store's e-mails, SMS, Stripe calls, calendar pushes and notices are
 * never sent, whatever wrote them. `isDemo` is the store check, the database's
 * by default.
 */
export function withDemoStorePolicy(
  senders: ApiEffectSenders,
  isDemo: (storeId: string) => Promise<boolean> = (storeId) => isDemoStore(db, storeId),
): ApiEffectSenders {
  const wrapped: Record<string, AnySender> = {};
  for (const [type, send] of Object.entries(senders) as Array<[string, AnySender]>) {
    wrapped[type] = async (payload, context) => {
      if (await isDemo(context.row.storeId)) return { skipped: "demo store" };
      return send(payload, context);
    };
  }
  return wrapped as ApiEffectSenders;
}
