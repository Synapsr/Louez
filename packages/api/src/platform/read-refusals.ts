/**
 * The codes a caller's read of a step (`handoffs.get`) answers that reading
 * again will not change: the step is not one this caller reads
 * (`handoffErrors.notFound`), its role no longer allows it
 * (`platformErrors.permissionDenied`), it is no longer a member of the store
 * (`platformErrors.noStore`), or it is signed out
 * (`platformErrors.unauthenticated`). A page that waits on a step stops on
 * one of these. Pure, without imports: a browser module reads it. Each is the
 * code its factory gives (apps/web/lib/ai/approval-card.test.ts).
 */
export const STEP_READ_REFUSALS = [
  "HANDOFF_NOT_FOUND",
  "PERMISSION_DENIED",
  "NO_STORE_ACCESS",
  "UNAUTHENTICATED",
] as const;
