import { orpc } from "@/lib/orpc/react";

/** The signed-in user's own interface preferences. Session-only procedures. */
export const accountMutations = {
  dismissNotice: () => orpc.dashboard.account.dismissNotice.mutationOptions(),
};
