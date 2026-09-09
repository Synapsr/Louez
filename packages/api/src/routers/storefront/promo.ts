import {
  storefrontPromoValidateInputSchema,
  storefrontPromoValidateOutputSchema,
} from "@louez/validations";
import { ORPCError } from "@orpc/server";

import { db } from "@louez/db";

import { storefrontProcedure } from "../../procedures";
import { checkPromoValidationRateLimit, validateStorefrontPromoCode } from "../../services";
import { toORPCError } from "../../utils/orpc-error";

/** Best-effort client IP behind the usual proxies; "unknown" shares one bucket. */
const getRequestIp = (headers: Headers): string => {
  const direct =
    headers.get("cf-connecting-ip") || headers.get("true-client-ip") || headers.get("x-real-ip");
  if (direct) {
    return direct.trim();
  }
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
};

/**
 * Public promo check for the checkout. The subtotal is repriced from the
 * catalog, never taken from the client, and the endpoint is rate limited per
 * store and IP because it lets a visitor probe codes.
 */
const validate = storefrontProcedure
  .input(storefrontPromoValidateInputSchema)
  .output(storefrontPromoValidateOutputSchema)
  .handler(async ({ context, input }) => {
    const limit = checkPromoValidationRateLimit(
      `${context.store.id}:${getRequestIp(context.headers)}`,
    );
    if (!limit.allowed) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: "errors.tooManyRequests",
        data: { retryAfter: limit.retryAfter },
      });
    }

    try {
      return await validateStorefrontPromoCode(db, {
        storeId: context.store.id,
        code: input.code,
        lines: input.lines,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

export const storefrontPromoRouter = {
  validate,
};
