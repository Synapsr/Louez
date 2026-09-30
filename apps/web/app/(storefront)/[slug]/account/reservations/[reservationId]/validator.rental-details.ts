import type { CustomerFieldIssueCode } from "@louez/validations";
import { z } from "zod";

import type {
  RentalDetailsFormValues,
  RentalDetailsItem,
} from "./reservation-rental-details.types";
import { getRentalDetailsIssues } from "./util.rental-details-form";

/** "Détails de la location" of the account, checked with the rules the server applies. */
export const createRentalDetailsSchema = (
  items: readonly RentalDetailsItem[],
  issueMessage: (code: CustomerFieldIssueCode) => string,
): z.ZodType<RentalDetailsFormValues, RentalDetailsFormValues> =>
  z
    .object({
      units: z.record(
        z.string(),
        z.object({
          participantName: z.string().optional(),
          values: z.record(z.string(), z.string()).optional(),
        }),
      ),
    })
    .superRefine((data, ctx) => {
      for (const issue of getRentalDetailsIssues(items, data)) {
        ctx.addIssue({ code: "custom", message: issueMessage(issue.code), path: issue.path });
      }
    });
