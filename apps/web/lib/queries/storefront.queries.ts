import type {
  StorefrontAvailabilityInput,
  StorefrontResolveCombinationInput,
} from "@louez/validations";

import { orpc } from "@/lib/orpc/react";

/**
 * Availability is a snapshot of other people's reservations: 30 s matches
 * the public availability route's cache window, so a period picked twice in
 * a row (catalog, then product page) reuses one response.
 */
const AVAILABILITY_STALE_TIME = 30_000;

/**
 * The gate re-checks the advisor status on its own signals (widget closed,
 * validation bumped), so a cached answer must never be served in between.
 */
const ADVISOR_STATUS_STALE_TIME = 0;

/** A conversation history only changes through the widget itself. */
const ADVISOR_MESSAGES_STALE_TIME = 5 * 60_000;

/**
 * Query options for the storefront oRPC procedures. Consumers call
 * `useQuery(storefrontQueries.availability(input))` directly; the cart
 * resolution lives in `cart.queries.ts`.
 */
export const storefrontQueries = {
  calendar: (input: {
    productId: string;
    periods: Array<{ startDate: string; endDate: string }>;
  }) =>
    orpc.storefront.availability.calendar.queryOptions({
      input,
      staleTime: AVAILABILITY_STALE_TIME,
      refetchOnWindowFocus: true,
    }),
  availability: (input: StorefrontAvailabilityInput) =>
    orpc.storefront.availability.get.queryOptions({
      input,
      staleTime: AVAILABILITY_STALE_TIME,
      refetchOnWindowFocus: true,
    }),
  /** Broad key for invalidating every period after a reservation is placed. */
  availabilityKey: () => orpc.storefront.availability.key(),
  resolveCombination: (input: StorefrontResolveCombinationInput) =>
    orpc.storefront.availability.resolveCombination.queryOptions({
      input,
      staleTime: AVAILABILITY_STALE_TIME,
      refetchOnWindowFocus: true,
    }),
  advisorStatus: (conversationId: string) =>
    orpc.storefront.aiAdvisor.getConversationStatus.queryOptions({
      input: { conversationId },
      staleTime: ADVISOR_STATUS_STALE_TIME,
    }),
  advisorMessages: (conversationId: string) =>
    orpc.storefront.aiAdvisor.getMessages.queryOptions({
      input: { conversationId },
      staleTime: ADVISOR_MESSAGES_STALE_TIME,
    }),
};
