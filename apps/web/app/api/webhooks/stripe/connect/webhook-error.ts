import Stripe from "stripe";

/**
 * What a log may say of an error: its class and code, never its message
 * (Stripe writes the platform key's masked tail into some, a database error
 * its parameters). Of a Stripe error, also its HTTP status and request id.
 */
export function describeWebhookError(error: unknown): Record<string, unknown> {
  if (error instanceof Stripe.errors.StripeError) {
    return {
      stripeError: {
        type: error.type,
        code: error.code ?? null,
        statusCode: error.statusCode ?? null,
        requestId: error.requestId ?? null,
      },
    };
  }
  const code = error instanceof Error ? Reflect.get(error, "code") : undefined;
  return {
    error: {
      name: error instanceof Error ? error.name : typeof error,
      code: typeof code === "string" || typeof code === "number" ? code : null,
    },
  };
}
