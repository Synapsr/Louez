/**
 * Shim: the instant-access module lives in `lib/customer-auth/`. Kept so
 * emails, invoicing and the dashboard keep compiling until WS-15 repoints them.
 */
export {
  INSTANT_ACCESS_DEFAULT_TTL_MS,
  INSTANT_ACCESS_SHORT_TTL_MS,
  createReservationInstantAccessUrl,
} from "@/lib/customer-auth/instant-access";
