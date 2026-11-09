import type { InsurancePort } from "@louez/api";

import { log } from "@/lib/evlog";
import {
  cancelTulipContractForReservation,
  createTulipContractForReservation,
} from "@/lib/integrations/tulip/contracts";

// JSON drops an Error's fields, so the event carries them, the stack too.
const errorFields = (error: unknown) =>
  error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) };

/**
 * The Tulip contracts of a reservation status change (ApiPorts.insurance).
 * A failure never fails the change: it is logged, and a failed creation
 * comes back as the warning the dashboard shows.
 */
export const tulipInsurancePort: InsurancePort = {
  createContract: async (reservationId) => {
    try {
      // The API and agents act for a store user, as the dashboard does.
      await createTulipContractForReservation({
        reservationId,
        source: "dashboard_reservation_confirmation",
      });
      return null;
    } catch (error) {
      log.error({
        reservation: {
          event: "tulip_contract_create_failed",
          reservationId,
          error: errorFields(error),
        },
      });
      return {
        key:
          error instanceof Error && error.message.startsWith("errors.")
            ? error.message
            : "errors.tulipContractCreationFailed",
      };
    }
  },
  cancelContract: async (reservationId) => {
    try {
      await cancelTulipContractForReservation({ reservationId });
    } catch (error) {
      log.error({
        reservation: {
          event: "tulip_contract_cancel_failed",
          reservationId,
          error: errorFields(error),
        },
      });
    }
  },
};
