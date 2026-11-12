import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, reservations } from "@louez/db";
import type { ReservationBillingSnapshot } from "@louez/types";
import { INDIVIDUAL_BILLING } from "@louez/utils";
import {
  dashboardReservationAssignUnitsInputSchema,
  dashboardReservationCaptureDepositHoldInputSchema,
  dashboardReservationCreateDepositHoldInputSchema,
  dashboardReservationCreateManualReservationInputSchema,
  dashboardReservationDeletePaymentInputSchema,
  dashboardReservationGetAvailableUnitsInputSchema,
  dashboardReservationGetByIdInputSchema,
  dashboardReservationGetPaymentMethodInputSchema,
  dashboardReservationPreviewManualTulipQuoteInputSchema,
  dashboardReservationGetEmailRenderContextInputSchema,
  dashboardReservationPreviewTulipQuoteInputSchema,
  dashboardReservationRecordDamageInputSchema,
  dashboardReservationRefundManualPaymentInputSchema,
  dashboardReservationRecordPaymentInputSchema,
  dashboardReservationReleaseDepositHoldInputSchema,
  dashboardReservationRequestPaymentInputSchema,
  dashboardReservationReturnDepositInputSchema,
  dashboardReservationSendAccessLinkInputSchema,
  dashboardReservationSendAccessLinkSmsInputSchema,
  dashboardReservationSendModificationEmailInputSchema,
  dashboardReservationSendReservationEmailInputSchema,
  dashboardReservationUpdateBillingInputSchema,
  dashboardReservationUpdateReservationInputSchema,
  dashboardReservationSignInStoreInputSchema,
  reservationSignOutputSchema,
  digitsOnly,
  isPlausibleVatNumber,
  isValidCompanyNumber,
  resolveCompanyNumberScheme,
} from "@louez/validations";

import { dashboardProcedure, requirePermission } from "../../procedures";
import { resolveDepositAttempt } from "./deposit-attempts";
import { getDashboardReservationEditContext, signReservationInStore } from "../../services";
import { toORPCError } from "../../utils/orpc-error";
import {
  cancel,
  get,
  getPlanningTimeline,
  list,
  listCalendarPeriod,
  listOverdue,
  listUpcoming,
  poll,
  updateNotes,
  updateStatus,
} from "./reservation-follow-up";

function toDate(value: string | Date | undefined): Date | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value : new Date(value);
}

function toOptionalPeriod(payload?: {
  previousStartDate?: string | Date;
  previousEndDate?: string | Date;
}) {
  const startDate = toDate(payload?.previousStartDate);
  const endDate = toDate(payload?.previousEndDate);
  if (!startDate || !endDate) return undefined;
  return { startDate, endDate };
}

const getEditContext = dashboardProcedure
  .input(dashboardReservationGetByIdInputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await getDashboardReservationEditContext({
        reservationId: input.reservationId,
        storeId: context.store.id,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

const getPaymentMethod = dashboardProcedure
  .input(dashboardReservationGetPaymentMethodInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.getReservationPaymentMethod;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.getReservationPaymentMethod not provided",
        });
      }
      return await fn(input.reservationId);
    } catch (error) {
      throw toORPCError(error);
    }
  });

const getAvailableUnitsForItem = dashboardProcedure
  .input(dashboardReservationGetAvailableUnitsInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.getAvailableUnitsForReservationItem;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.getAvailableUnitsForReservationItem not provided",
        });
      }
      const result = await fn(input.reservationItemId);
      if (result.error) {
        throw new ORPCError("BAD_REQUEST", { message: result.error });
      }
      return { units: result.units || [], assigned: result.assigned || [] };
    } catch (error) {
      throw toORPCError(error);
    }
  });

const createManualReservation = requirePermission("write")
  .input(dashboardReservationCreateManualReservationInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.createManualReservation;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.createManualReservation not provided",
        });
      }

      const payload = input.payload;
      const result = await fn({
        ...payload,
        startDate: toDate(payload.startDate)!,
        endDate: toDate(payload.endDate)!,
      });
      if (result.error === "errors.insufficientCapacity") {
        return {
          error: result.error,
          shortfalls: result.shortfalls || [],
        };
      }
      if (result.error) {
        throw new ORPCError("BAD_REQUEST", { message: result.error });
      }
      return result;
    } catch (error) {
      throw toORPCError(error);
    }
  });

const updateReservation = requirePermission("write")
  .input(dashboardReservationUpdateReservationInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.updateReservation;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.updateReservation not provided",
        });
      }

      const payload = input.payload;
      const result = await fn(input.reservationId, {
        ...payload,
        startDate: toDate(payload.startDate),
        endDate: toDate(payload.endDate),
      });

      if ("error" in result && result.error) {
        return {
          success: false as const,
          error: result.error,
          ...("bufferConflict" in result && result.bufferConflict
            ? { bufferConflict: result.bufferConflict }
            : {}),
          ...("failedUnitIds" in result && result.failedUnitIds
            ? { failedUnitIds: result.failedUnitIds }
            : {}),
          ...("conflicts" in result && result.conflicts ? { conflicts: result.conflicts } : {}),
          ...("shortfalls" in result && result.shortfalls ? { shortfalls: result.shortfalls } : {}),
          ...("reservationItemId" in result && result.reservationItemId
            ? { reservationItemId: result.reservationItemId }
            : {}),
          ...("assignedCount" in result && result.assignedCount
            ? { assignedCount: result.assignedCount }
            : {}),
        };
      }
      return result;
    } catch (error) {
      throw toORPCError(error);
    }
  });

const previewTulipQuote = requirePermission("write")
  .input(dashboardReservationPreviewTulipQuoteInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.previewReservationTulipQuote;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.previewReservationTulipQuote not provided",
        });
      }

      const payload = input.payload;
      return await fn(input.reservationId, {
        ...payload,
        startDate: toDate(payload.startDate)!,
        endDate: toDate(payload.endDate)!,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

const previewManualTulipQuote = requirePermission("write")
  .input(dashboardReservationPreviewManualTulipQuoteInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.previewManualTulipQuote;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.previewManualTulipQuote not provided",
        });
      }

      const payload = input.payload;
      return await fn({
        ...payload,
        startDate: toDate(payload.startDate)!,
        endDate: toDate(payload.endDate)!,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

/**
 * Rewrites who a reservation is billed to. Only the billing identity moves;
 * the customer profile is untouched, as it is a default for the next
 * checkout rather than a record of this reservation.
 */
const updateBilling = requirePermission("write")
  .input(dashboardReservationUpdateBillingInputSchema)
  .output(
    z.object({
      success: z.literal(true),
      billingSnapshot: z.object({
        customerType: z.enum(["individual", "business"]),
        companyName: z.string().nullable(),
        companyNumber: z.string().nullable(),
        companyNumberScheme: z.enum(["fr_siren", "be_bce"]).nullable(),
        vatNumber: z.string().nullable(),
      }),
    }),
  )
  .handler(async ({ context, input }) => {
    try {
      const reservation = await db.query.reservations.findFirst({
        columns: { id: true },
        where: and(
          eq(reservations.id, input.reservationId),
          eq(reservations.storeId, context.store.id),
        ),
        with: { customer: { columns: { country: true } } },
      });
      if (!reservation) {
        throw new ORPCError("NOT_FOUND", { message: "errors.reservationNotFound" });
      }

      let billingSnapshot: ReservationBillingSnapshot = INDIVIDUAL_BILLING;
      if (input.customerType === "business") {
        if (!input.companyName) {
          throw new ORPCError("BAD_REQUEST", { message: "errors.companyNameRequired" });
        }
        const country = reservation.customer.country || "FR";
        if (input.companyNumber && !isValidCompanyNumber(country, input.companyNumber)) {
          throw new ORPCError("BAD_REQUEST", { message: "errors.invalidCompanyNumber" });
        }
        const vatNumber = input.vatNumber.replace(/\s/g, "").toUpperCase();
        if (!isPlausibleVatNumber(country, vatNumber)) {
          throw new ORPCError("BAD_REQUEST", { message: "errors.invalidVatNumber" });
        }
        const scheme = resolveCompanyNumberScheme(country);
        const companyNumber = input.companyNumber
          ? scheme
            ? digitsOnly(input.companyNumber)
            : input.companyNumber
          : null;
        billingSnapshot = {
          customerType: "business",
          companyName: input.companyName,
          companyNumber,
          companyNumberScheme: companyNumber ? scheme : null,
          vatNumber: vatNumber || null,
        };
      }

      await db
        .update(reservations)
        .set({ billingSnapshot, updatedAt: new Date() })
        .where(
          and(eq(reservations.id, input.reservationId), eq(reservations.storeId, context.store.id)),
        );

      return { success: true as const, billingSnapshot };
    } catch (error) {
      throw toORPCError(error);
    }
  });

const recordPayment = requirePermission("write")
  .input(dashboardReservationRecordPaymentInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.recordPayment;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.recordPayment not provided",
        });
      }
      const result = await fn(input.reservationId, {
        ...input.payload,
        paidAt: toDate(input.payload.paidAt),
      });
      if (result.error) {
        throw new ORPCError("BAD_REQUEST", { message: result.error });
      }
      return result;
    } catch (error) {
      throw toORPCError(error);
    }
  });

const refundManualPayment = requirePermission("write")
  .input(dashboardReservationRefundManualPaymentInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.refundManualPayment;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.refundManualPayment not provided",
        });
      }
      const result = await fn(input.reservationId, input.payload);
      if (result.error) {
        throw new ORPCError("BAD_REQUEST", { message: result.error });
      }
      return result;
    } catch (error) {
      throw toORPCError(error);
    }
  });

const deletePayment = requirePermission("write")
  .input(dashboardReservationDeletePaymentInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.deletePayment;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.deletePayment not provided",
        });
      }
      const result = await fn(input.paymentId);
      if (result.error) {
        throw new ORPCError("BAD_REQUEST", { message: result.error });
      }
      return { success: true as const };
    } catch (error) {
      throw toORPCError(error);
    }
  });

const returnDeposit = requirePermission("write")
  .input(dashboardReservationReturnDepositInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.returnDeposit;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.returnDeposit not provided",
        });
      }
      const result = await fn(input.reservationId, input.payload);
      if (result.error) {
        throw new ORPCError("BAD_REQUEST", { message: result.error });
      }
      return result;
    } catch (error) {
      throw toORPCError(error);
    }
  });

const recordDamage = requirePermission("write")
  .input(dashboardReservationRecordDamageInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.recordDamage;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.recordDamage not provided",
        });
      }
      const result = await fn(input.reservationId, input.payload);
      if (result.error) {
        throw new ORPCError("BAD_REQUEST", { message: result.error });
      }
      return result;
    } catch (error) {
      throw toORPCError(error);
    }
  });

const createDepositHold = requirePermission("write")
  .input(dashboardReservationCreateDepositHoldInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.createDepositHold;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.createDepositHold not provided",
        });
      }
      const result = await fn(input.reservationId);
      if ("error" in result && result.error) {
        throw new ORPCError("BAD_REQUEST", { message: result.error as string });
      }
      return result;
    } catch (error) {
      throw toORPCError(error);
    }
  });

const captureDepositHold = requirePermission("write")
  .input(dashboardReservationCaptureDepositHoldInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.captureDepositHold;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.captureDepositHold not provided",
        });
      }
      const result = await fn(input.reservationId, input.payload);
      if ("error" in result && result.error) {
        throw new ORPCError("BAD_REQUEST", { message: result.error as string });
      }
      return result;
    } catch (error) {
      throw toORPCError(error);
    }
  });

const releaseDepositHold = requirePermission("write")
  .input(dashboardReservationReleaseDepositHoldInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.releaseDepositHold;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.releaseDepositHold not provided",
        });
      }
      const result = await fn(input.reservationId);
      if ("error" in result && result.error) {
        throw new ORPCError("BAD_REQUEST", { message: result.error as string });
      }
      return result;
    } catch (error) {
      throw toORPCError(error);
    }
  });

const assignUnitsToItem = requirePermission("write")
  .input(dashboardReservationAssignUnitsInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.assignUnitsToReservationItem;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.assignUnitsToReservationItem not provided",
        });
      }
      const result = await fn(input.reservationItemId, input.unitIds, {
        overrideTurnoverBuffer: input.overrideTurnoverBuffer,
      });
      if (result.error) {
        return {
          success: false as const,
          error: result.error,
          ...(result.bufferConflict ? { bufferConflict: result.bufferConflict } : {}),
          ...(result.failedUnitIds ? { failedUnitIds: result.failedUnitIds } : {}),
        };
      }
      return {
        success: true as const,
        ...(result.warnings ? { warnings: result.warnings } : {}),
      };
    } catch (error) {
      throw toORPCError(error);
    }
  });

const sendReservationEmail = requirePermission("write")
  .input(dashboardReservationSendReservationEmailInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.sendReservationEmail;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.sendReservationEmail not provided",
        });
      }
      const result = await fn(input.reservationId, input.payload);
      if (result.error) {
        throw new ORPCError("BAD_REQUEST", { message: result.error });
      }
      return { success: true as const };
    } catch (error) {
      throw toORPCError(error);
    }
  });

const emailContentOverrideSchema = z
  .object({
    subject: z.string().optional(),
    greeting: z.string().optional(),
    message: z.string().optional(),
    signature: z.string().optional(),
  })
  .optional();

// Everything the browser needs to render the manual reservation emails
// locally (live preview). Unknown keys are stripped, so loose JSON columns
// (emailSettings) never leak past the fields composition actually reads.
const getEmailRenderContextOutputSchema = z.object({
  store: z.object({
    name: z.string(),
    email: z.string().nullish(),
    phone: z.string().nullish(),
    address: z.string().nullish(),
    theme: z
      .object({
        mode: z.enum(["light", "dark"]).optional(),
        primaryColor: z.string().optional(),
      })
      .nullish(),
    settings: z
      .object({
        currency: z.string().optional(),
        country: z.string().optional(),
        timezone: z.string().optional(),
      })
      .nullish(),
    emailSettings: z
      .object({
        pickupReminderContent: emailContentOverrideSchema,
        returnReminderContent: emailContentOverrideSchema,
      })
      .nullish(),
  }),
  customer: z.object({
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
  }),
  reservation: z.object({
    id: z.string(),
    number: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    totalAmount: z.string(),
    depositAmount: z.string(),
    // The reservation's own currency; null or absent for one older than it, which
    // states the store's.
    currency: z.string().nullish(),
    items: z.array(
      z.object({
        name: z.string(),
        quantity: z.number(),
        totalPrice: z.string(),
      }),
    ),
  }),
  reservationUrl: z.string(),
  logoUrl: z.string().nullable(),
  showPaymentCta: z.boolean(),
  contractSigned: z.boolean(),
});

const getEmailRenderContext = requirePermission("write")
  .input(dashboardReservationGetEmailRenderContextInputSchema)
  .output(getEmailRenderContextOutputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.getManualEmailRenderContext;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.getManualEmailRenderContext not provided",
        });
      }
      const result = await fn(input.reservationId);
      if ("error" in result) {
        throw new ORPCError("BAD_REQUEST", { message: result.error });
      }
      return result;
    } catch (error) {
      throw toORPCError(error);
    }
  });

const sendModificationEmail = requirePermission("write")
  .input(dashboardReservationSendModificationEmailInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.sendReservationModificationEmail;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.sendReservationModificationEmail not provided",
        });
      }
      const result = await fn(input.reservationId, {
        previousPeriod: toOptionalPeriod(input.payload),
      });
      if (result.error) {
        throw new ORPCError("BAD_REQUEST", { message: result.error });
      }
      return { success: true as const };
    } catch (error) {
      throw toORPCError(error);
    }
  });

const sendAccessLink = requirePermission("write")
  .input(dashboardReservationSendAccessLinkInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.sendAccessLink;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.sendAccessLink not provided",
        });
      }
      const result = await fn(input.reservationId, input.payload);
      if (result.error) {
        throw new ORPCError("BAD_REQUEST", { message: result.error });
      }
      return { success: true as const };
    } catch (error) {
      throw toORPCError(error);
    }
  });

const sendAccessLinkBySms = requirePermission("write")
  .input(dashboardReservationSendAccessLinkSmsInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.sendAccessLinkBySms;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.sendAccessLinkBySms not provided",
        });
      }
      const result = await fn(input.reservationId);
      if (result.error) {
        throw new ORPCError("BAD_REQUEST", { message: result.error });
      }
      return result;
    } catch (error) {
      throw toORPCError(error);
    }
  });

const requestPayment = requirePermission("write")
  .input(dashboardReservationRequestPaymentInputSchema)
  .handler(async ({ context, input }) => {
    try {
      const fn = context.dashboardReservationActions?.requestPayment;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "dashboardReservationActions.requestPayment not provided",
        });
      }
      const result = await fn(input.reservationId, input.payload);
      if (result.error) {
        throw new ORPCError("BAD_REQUEST", { message: result.error });
      }
      return { success: true as const, paymentUrl: result.paymentUrl || null };
    } catch (error) {
      throw toORPCError(error);
    }
  });

// The customer signs on the renter's device, usually at pickup.
const signInStore = requirePermission("write")
  .input(dashboardReservationSignInStoreInputSchema)
  .output(reservationSignOutputSchema)
  .handler(async ({ context, input }) => {
    try {
      return await signReservationInStore({
        reservationId: input.reservationId,
        storeId: context.store.id,
        userId: context.session.user.id,
        signerName: input.signerName,
        image: input.signature,
        headers: context.headers,
        regenerateContract: context.regenerateContract,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

export const dashboardReservationsRouter = {
  // Follow-up (reservation-follow-up.ts): on every transport.
  list,
  get,
  poll,
  listCalendarPeriod,
  getPlanningTimeline,
  listUpcoming,
  listOverdue,
  updateStatus,
  cancel,
  updateNotes,
  getEditContext,
  getPaymentMethod,
  getAvailableUnitsForItem,
  createManualReservation,
  updateReservation,
  previewTulipQuote,
  previewManualTulipQuote,
  updateBilling,
  recordPayment,
  refundManualPayment,
  deletePayment,
  returnDeposit,
  recordDamage,
  createDepositHold,
  captureDepositHold,
  releaseDepositHold,
  // A deposit hold Stripe has not confirmed (deposit-attempts.ts): the dashboard only.
  resolveDepositAttempt,
  assignUnitsToItem,
  sendReservationEmail,
  getEmailRenderContext,
  sendModificationEmail,
  sendAccessLink,
  sendAccessLinkBySms,
  requestPayment,
  signInStore,
};
