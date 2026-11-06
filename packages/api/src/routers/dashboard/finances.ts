import { z } from "zod";

import {
  financeDepositsInputSchema,
  financeDepositsOutputSchema,
  financeMovementDetailInputSchema,
  financeMovementDetailOutputSchema,
  financeMovementSchema,
  financeMovementsInputSchema,
  financeMovementsOutputSchema,
  financeOutstandingInputSchema,
  financeOutstandingOutputSchema,
  financePeriodInputSchema,
  financeSummaryInputSchema,
  financeSummaryOutputSchema,
} from "@louez/validations";

import { dashboardProcedure } from "../../procedures";
import {
  getFinanceDeposits,
  getFinanceMovementDetail,
  getFinanceMovements,
  getFinanceOutstanding,
  getFinanceRecap,
  getFinanceSummary,
} from "../../services";
import { toORPCError } from "../../utils/orpc-error";

// Readable by every store member, like Analytics: the employee is the one who
// closes the till. Only the CSV export (`/api/export`) stays owner-only.

const summary = dashboardProcedure
  .input(financeSummaryInputSchema)
  .output(financeSummaryOutputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await getFinanceSummary({
        storeId: context.store.id,
        timezone: context.store.settings?.timezone,
        period: input,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

const movements = dashboardProcedure
  .input(financeMovementsInputSchema)
  .output(financeMovementsOutputSchema)
  .handler(async ({ context, input }) => {
    const { period, from, to, page, pageSize, ...filters } = input;
    try {
      return await getFinanceMovements({
        storeId: context.store.id,
        timezone: context.store.settings?.timezone,
        period: { period, from, to },
        filters,
        page,
        pageSize,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

const movementDetail = dashboardProcedure
  .input(financeMovementDetailInputSchema)
  .output(financeMovementDetailOutputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await getFinanceMovementDetail({
        storeId: context.store.id,
        timezone: context.store.settings?.timezone,
        paymentId: input.paymentId,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

/** Every settled movement of the period: what the till-closing printout lists. */
const recap = dashboardProcedure
  .input(financePeriodInputSchema)
  .output(z.object({ movements: z.array(financeMovementSchema), truncated: z.boolean() }))
  .handler(async ({ context, input }) => {
    try {
      return await getFinanceRecap({
        storeId: context.store.id,
        timezone: context.store.settings?.timezone,
        period: input,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

const outstanding = dashboardProcedure
  .input(financeOutstandingInputSchema)
  .output(financeOutstandingOutputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await getFinanceOutstanding({
        storeId: context.store.id,
        page: input.page,
        pageSize: input.pageSize,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

const deposits = dashboardProcedure
  .input(financeDepositsInputSchema)
  .output(financeDepositsOutputSchema)
  .handler(async ({ context }) => {
    try {
      return await getFinanceDeposits({ storeId: context.store.id });
    } catch (error) {
      throw toORPCError(error);
    }
  });

export const dashboardFinancesRouter = {
  summary,
  movements,
  movementDetail,
  recap,
  outstanding,
  deposits,
};
