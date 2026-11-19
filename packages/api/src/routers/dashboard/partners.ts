import { z } from "zod";

import {
  adjustPartnerCommissionInput,
  cancelPartnerPayoutInput,
  createPartnerInput,
  getPartnerStatementInput,
  getPartnerStatementOutput,
  getReservationPartnerInput,
  listPartnersInput,
  listPartnersOutput,
  markPartnerMonthPaidInput,
  partnerOutput,
  partnerTotalsOutput,
  reservationPartnerSchema,
  rotatePartnerStatementTokenInput,
  rotatePartnerStatementTokenOutput,
  setPartnerArchivedInput,
  setReservationPartnerInput,
  updatePartnerInput,
} from "../../contracts/partners";
import { storeProcedure } from "../../platform/procedures";
import {
  adjustPartnerCommission,
  cancelPartnerPayout,
  createPartner,
  getPartnerStatement,
  getReservationPartner,
  listPartners,
  markPartnerMonthPaid,
  rotatePartnerStatementToken,
  setPartnerArchived,
  setReservationPartner,
  updatePartner,
} from "../../services/partners";

/**
 * Liens partenaires (services/partners.ts), in « Se faire connaître ». A
 * person in a dashboard session for now, like the rest of the guide: read
 * access for assistants is phase 2 (docs/product/liens-partenaires.md).
 */
const partners = storeProcedure.meta({
  actors: ["session"],
  mcp: { exclude: "partner links: dashboard session only in phase 1" },
});

const read = (capability: string) =>
  partners.meta({ capability, scope: { domain: "online_store", level: "read" } });
const write = (capability: string) =>
  partners.meta({ capability, scope: { domain: "online_store", level: "write" } });

const done = z.object({ ok: z.literal(true) });

const list = read("online_store.listPartners")
  .input(listPartnersInput)
  .output(listPartnersOutput)
  .handler(({ context, input }) => listPartners(context.actor.storeId, input.month));

const getStatement = read("online_store.getPartnerStatement")
  .input(getPartnerStatementInput)
  .output(getPartnerStatementOutput)
  .handler(({ context, input }) =>
    getPartnerStatement(context.actor.storeId, input.partnerId, input.month),
  );

const create = write("online_store.createPartner")
  .input(createPartnerInput)
  .output(partnerOutput)
  .handler(({ context, input }) => createPartner(context.actor.storeId, input));

const update = write("online_store.updatePartner")
  .input(updatePartnerInput)
  .output(partnerOutput)
  .handler(({ context, input: { partnerId, ...fields } }) =>
    updatePartner(context.actor.storeId, partnerId, fields),
  );

const setArchived = write("online_store.setPartnerArchived")
  .input(setPartnerArchivedInput)
  .output(partnerOutput)
  .handler(({ context, input }) =>
    setPartnerArchived(context.actor.storeId, input.partnerId, input.archived),
  );

const rotateStatementToken = write("online_store.rotatePartnerStatementToken")
  .input(rotatePartnerStatementTokenInput)
  .output(rotatePartnerStatementTokenOutput)
  .handler(({ context, input }) =>
    rotatePartnerStatementToken(context.actor.storeId, input.partnerId),
  );

const markMonthPaid = write("online_store.markPartnerMonthPaid")
  .input(markPartnerMonthPaidInput)
  .output(partnerTotalsOutput)
  .handler(({ context, input }) =>
    markPartnerMonthPaid({
      storeId: context.actor.storeId,
      userId: context.actor.credential.userId,
      partnerId: input.partnerId,
      month: input.month,
    }),
  );

const cancelPayout = write("online_store.cancelPartnerPayout")
  .input(cancelPartnerPayoutInput)
  .output(done)
  .handler(async ({ context, input }) => {
    await cancelPartnerPayout(context.actor.storeId, input.payoutId);
    return { ok: true as const };
  });

const adjustCommission = write("online_store.adjustPartnerCommission")
  .input(adjustPartnerCommissionInput)
  .output(done)
  .handler(async ({ context, input }) => {
    await adjustPartnerCommission({ storeId: context.actor.storeId, ...input });
    return { ok: true as const };
  });

const getForReservation = read("online_store.getReservationPartner")
  .input(getReservationPartnerInput)
  .output(reservationPartnerSchema)
  .handler(({ context, input }) =>
    getReservationPartner(context.actor.storeId, input.reservationId),
  );

const setForReservation = write("online_store.setReservationPartner")
  .input(setReservationPartnerInput)
  .output(done)
  .handler(async ({ context, input }) => {
    await setReservationPartner({
      storeId: context.actor.storeId,
      userId: context.actor.credential.userId,
      ...input,
    });
    return { ok: true as const };
  });

export const dashboardPartnersRouter = {
  list,
  getStatement,
  create,
  update,
  setArchived,
  rotateStatementToken,
  markMonthPaid,
  cancelPayout,
  adjustCommission,
  getForReservation,
  setForReservation,
};
