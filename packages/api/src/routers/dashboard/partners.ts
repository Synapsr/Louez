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
  partnerSettingsSchema,
  partnerTotalsOutput,
  reservationPartnerSchema,
  rotatePartnerStatementTokenInput,
  rotatePartnerStatementTokenOutput,
  setPartnerArchivedInput,
  setReservationPartnerInput,
  updatePartnerInput,
  updatePartnerSettingsInput,
} from "../../contracts/partners";
import { dashboardPageLinks } from "../../platform/links";
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
  updatePartnerSettings,
} from "../../services/partners";

/**
 * Liens partenaires (services/partners.ts), in « Se faire connaître ». The
 * partners and their statements are read by every transport, assistants
 * included; the writes stay with a person in a dashboard session for now.
 */
const partners = storeProcedure.meta({
  actors: ["session"],
  mcp: { exclude: "partner links: writes stay in a dashboard session" },
});

const write = (capability: string) =>
  partners.meta({ capability, scope: { domain: "online_store", level: "write" } });

const done = z.object({ ok: z.literal(true) });

const PARTNERS_PAGE = "/dashboard/visibility/partners" as const;

const AMOUNTS =
  "Amounts are in `currency`, rounded to its minor unit. A commission is computed on the rental after discount, without deposit, delivery or insurance; it is `upcoming` until the rental ends, `due` once completed or past its end, `cancelled` with the reservation. The store pays its partners itself: `paid` is what it recorded.";

const list = storeProcedure
  .meta({
    capability: "online_store.listPartners",
    scope: { domain: "online_store", level: "read" },
    mcp: {
      name: "partners_list",
      title: "List Partners",
      description: `List the store's partners (campsites, hotels, tourist offices that send customers through their own link) with their commission rule and, for a month (the current one by default), the bookings they brought and what the store owes them: \`due\`, \`paid\`, \`remaining\`, \`upcoming\`, and the visits through their link. ${AMOUNTS} Also gives the attribution window and its \`links\` to the partners page.`,
      bundle: "daily",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "GET",
    path: "/partners",
    description: `Returns the store's partners with their commission rule and their figures for a month (\`month\`, YYYY-MM, the current one by default): bookings, \`due\`, \`paid\`, \`remaining\`, \`upcoming\` and visits through their link. ${AMOUNTS}`,
  })
  .input(listPartnersInput)
  .output(listPartnersOutput)
  .handler(async ({ context, input }) => ({
    ...(await listPartners(context.actor.storeId, input.month)),
    links: dashboardPageLinks(context.ports.urls, context.store, PARTNERS_PAGE),
  }));

const getStatement = storeProcedure
  .meta({
    capability: "online_store.getPartnerStatement",
    scope: { domain: "online_store", level: "read" },
    mcp: {
      name: "partners_get_statement",
      title: "Get Partner Statement",
      description: `Get one partner's statement for a month (the current one by default; the month a rental ends in): each reservation credited to it, with its dates, the rental it is computed on, the commission, any adjustment and its state, then the month's totals and the payments the store recorded. ${AMOUNTS} Answers "how much do I owe the campsite this month?". Its \`links\` hold the partner's page of the dashboard.`,
      bundle: "daily",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "GET",
    path: "/partners/{partnerId}/statement",
    description: `Returns a partner's statement for a month (\`month\`, YYYY-MM, the current one by default): its reservations with dates, rental base, commission, adjustment and state, the month's totals and the recorded payments. ${AMOUNTS}`,
  })
  .input(getPartnerStatementInput)
  .output(getPartnerStatementOutput)
  .handler(async ({ context, input }) => ({
    ...(await getPartnerStatement(context.actor.storeId, input.partnerId, input.month)),
    links: dashboardPageLinks(
      context.ports.urls,
      context.store,
      `${PARTNERS_PAGE}/${encodeURIComponent(input.partnerId)}`,
    ),
  }));

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

const updateSettings = write("online_store.updatePartnerSettings")
  .input(updatePartnerSettingsInput)
  .output(partnerSettingsSchema)
  .handler(({ context, input }) => updatePartnerSettings(context.actor.storeId, input));

const rotateStatementToken = write("online_store.rotatePartnerStatementToken")
  .input(rotatePartnerStatementTokenInput)
  .output(rotatePartnerStatementTokenOutput)
  .handler(({ context, input }) =>
    rotatePartnerStatementToken(context.actor.storeId, input.partnerId),
  );

const markMonthPaid = write("online_store.markPartnerMonthPaid")
  .input(markPartnerMonthPaidInput)
  .output(partnerTotalsOutput)
  .handler(async ({ context, input }) => {
    const { totals, effectIds } = await markPartnerMonthPaid({
      storeId: context.actor.storeId,
      userId: context.actor.credential.userId,
      partnerId: input.partnerId,
      month: input.month,
    });
    context.ports.dispatchEffects(effectIds);
    return totals;
  });

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

const getForReservation = partners
  .meta({
    capability: "online_store.getReservationPartner",
    scope: { domain: "online_store", level: "read" },
  })
  .input(getReservationPartnerInput)
  .output(reservationPartnerSchema)
  .handler(({ context, input }) =>
    getReservationPartner(context.actor.storeId, input.reservationId),
  );

const setForReservation = write("online_store.setReservationPartner")
  .input(setReservationPartnerInput)
  .output(done)
  .handler(async ({ context, input }) => {
    const { effectIds } = await setReservationPartner({
      storeId: context.actor.storeId,
      userId: context.actor.credential.userId,
      ...input,
    });
    context.ports.dispatchEffects(effectIds);
    return { ok: true as const };
  });

export const dashboardPartnersRouter = {
  list,
  getStatement,
  create,
  update,
  setArchived,
  updateSettings,
  rotateStatementToken,
  markMonthPaid,
  cancelPayout,
  adjustCommission,
  getForReservation,
  setForReservation,
};
