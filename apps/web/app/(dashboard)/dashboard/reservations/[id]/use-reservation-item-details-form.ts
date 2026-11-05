"use client";

import { useState } from "react";

import { ORPCError } from "@orpc/client";
import { revalidateLogic } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";
import { type CustomerFieldIssueCode, reservationItemDetailIssueSchema } from "@louez/validations";
import { z } from "zod";

import { useAppForm } from "@/hooks/form/form";
import { orpc } from "@/lib/orpc/react";
import { getErrorMessageKey } from "@/lib/utils/util.error-message";

import {
  getItemDetailIssueKey,
  indexItemDetailIssues,
  type ItemDetailsFormValues,
  toItemDetailsUpdateInput,
} from "./util.reservation-item-details";

const PARTICIPANT_NAME_MAX_LENGTH = 100;

/** `data` of the BAD_REQUEST `updateItemDetails` answers when a value cannot be stored. */
const issuesDataSchema = z.object({ issues: z.array(reservationItemDetailIssueSchema) });

interface UseReservationItemDetailsFormParams {
  reservationId: string;
  defaultValues: ItemDetailsFormValues;
  onSaved: () => void;
}

export const useReservationItemDetailsForm = ({
  reservationId,
  defaultValues,
  onSaved,
}: UseReservationItemDetailsFormParams) => {
  const t = useTranslations("dashboard.reservationDetails.itemDetails");
  const tValidation = useTranslations("validation");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const [rootError, setRootError] = useState<string | null>(null);
  const [fieldIssues, setFieldIssues] = useState<Record<string, CustomerFieldIssueCode>>({});

  const save = useMutation(
    orpc.dashboard.reservationDetails.updateItemDetails.mutationOptions({
      // The answer is the card's whole content: no refetch needed.
      onSuccess: (data) => {
        queryClient.setQueryData(
          orpc.dashboard.reservationDetails.itemDetails.queryOptions({ input: { reservationId } })
            .queryKey,
          data,
        );
      },
    }),
  );

  // Custom values are checked by the server, which knows the live definitions;
  // only the free-text name has a client-side limit.
  const schema = z.object({
    items: z.array(
      z.object({
        reservationItemId: z.string(),
        units: z.array(
          z.object({
            unitIndex: z.number(),
            participantName: z
              .string()
              .max(
                PARTICIPANT_NAME_MAX_LENGTH,
                tValidation("maxLength", { max: PARTICIPANT_NAME_MAX_LENGTH }),
              ),
            values: z.record(z.string(), z.string()),
          }),
        ),
      }),
    ),
  });

  const form = useAppForm({
    defaultValues,
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setRootError(null);
      setFieldIssues({});
      const input = toItemDetailsUpdateInput(reservationId, defaultValues, value);
      if (!input) {
        onSaved();
        return;
      }

      try {
        await save.mutateAsync(input);
      } catch (error) {
        const issues =
          error instanceof ORPCError ? issuesDataSchema.safeParse(error.data) : undefined;
        if (issues?.success) setFieldIssues(indexItemDetailIssues(issues.data.issues));
        const key = getErrorMessageKey(error);
        setRootError(tErrors.has(key) ? tErrors(key) : tErrors("generic"));
        return;
      }

      toastManager.add({ title: t("saved"), type: "success" });
      onSaved();
    },
  });

  /** A refused value stops being flagged as soon as someone corrects it. */
  const clearIssue = (reservationItemId: string, unitIndex: number, definitionId: string) => {
    const key = getItemDetailIssueKey(reservationItemId, unitIndex, definitionId);
    setFieldIssues((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  return { form, rootError, fieldIssues, clearIssue };
};

export type ReservationItemDetailsFormApi = ReturnType<
  typeof useReservationItemDetailsForm
>["form"];
