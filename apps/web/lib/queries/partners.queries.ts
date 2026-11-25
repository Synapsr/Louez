import { queryOptions } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc/react";

export const partnersQueries = {
  /** The store's partners, each with its figures for a month (the current one by default). */
  list: (month?: string) =>
    queryOptions({
      ...orpc.dashboard.partners.list.queryOptions({ input: { month } }),
      staleTime: 30_000,
    }),
  /** A partner's statement for a month. */
  statement: (partnerId: string, month?: string) =>
    queryOptions({
      ...orpc.dashboard.partners.getStatement.queryOptions({ input: { partnerId, month } }),
      staleTime: 30_000,
    }),
  /** The link to a partner's space, for a person who manages partners (`manage_settings`). */
  spaceLink: (partnerId: string) =>
    queryOptions({
      ...orpc.dashboard.partners.getSpaceLink.queryOptions({ input: { partnerId } }),
      staleTime: 30_000,
    }),
  /** The partner a reservation is attributed to, and the ones it can be. */
  forReservation: (reservationId: string) =>
    queryOptions({
      ...orpc.dashboard.partners.getForReservation.queryOptions({ input: { reservationId } }),
      staleTime: 30_000,
    }),
  /** Broad key, for invalidating after any partner write. */
  key: () => orpc.dashboard.partners.key(),
};

export const partnersMutations = {
  create: () => orpc.dashboard.partners.create.mutationOptions(),
  update: () => orpc.dashboard.partners.update.mutationOptions(),
  setArchived: () => orpc.dashboard.partners.setArchived.mutationOptions(),
  updateSettings: () => orpc.dashboard.partners.updateSettings.mutationOptions(),
  rotateStatementToken: () => orpc.dashboard.partners.rotateStatementToken.mutationOptions(),
  /** With the attempt's idempotency key: a retry of the same attempt records nothing more. */
  markMonthPaid: (idempotencyKey: string | undefined) =>
    orpc.dashboard.partners.markMonthPaid.mutationOptions({ context: { idempotencyKey } }),
  cancelPayout: () => orpc.dashboard.partners.cancelPayout.mutationOptions(),
  adjustCommission: () => orpc.dashboard.partners.adjustCommission.mutationOptions(),
  setForReservation: () => orpc.dashboard.partners.setForReservation.mutationOptions(),
};
