/**
 * What the plan change preview action answers (previewPlanChange): `now` with the
 * amount Stripe charges at once, in the currency's minor units (0 during a trial),
 * `at_period_end` with the day the new plan starts, `checkout` when Stripe had ended the
 * subscription, or an `errors.*` key.
 */
export type PlanChangePreviewAnswer =
  | { readonly kind: "now"; readonly amountDue: number; readonly currency: string }
  | { readonly kind: "at_period_end"; readonly at: Date }
  | { readonly kind: "checkout" }
  | { readonly error: string };

/** What the plan change dialog shows while, and once, Stripe previews the change. */
export type PlanChangePreviewView =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly error: string }
  | { readonly status: "now"; readonly amountDue: number; readonly currency: string }
  | { readonly status: "at_period_end"; readonly at: Date }
  | { readonly status: "checkout" };

/** The dialog's view of the preview query: an action that throws shows the generic error. */
export const planChangePreviewView = (query: {
  readonly data: PlanChangePreviewAnswer | undefined;
  readonly isError: boolean;
}): PlanChangePreviewView => {
  if (query.isError) return { status: "error", error: "errors.generic" };
  const answer = query.data;
  if (!answer) return { status: "loading" };
  if ("error" in answer) return { status: "error", error: answer.error };
  switch (answer.kind) {
    case "now":
      return { status: "now", amountDue: answer.amountDue, currency: answer.currency };
    case "at_period_end":
      return { status: "at_period_end", at: answer.at };
    case "checkout":
      return { status: "checkout" };
  }
};

/** The owner confirms a change only once the dialog says what it does. */
export const canConfirmPlanChange = (view: PlanChangePreviewView): boolean =>
  view.status !== "loading" && view.status !== "error";
