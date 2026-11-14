"use client";

import { useState } from "react";

import { DECISION_REASON_MAX } from "@louez/api/contracts/handoffs";
import { Button, Checkbox, Label, Textarea } from "@louez/ui";

interface HandoffDecisionFormProps {
  /** Where the form posts the answer: the step's `decide` route. */
  action: string;
  /** The revision of the request shown: the answer is about it, and no other. */
  revision: number;
  /** The kind's digest of what the page shows (an invitation's `invitationShown`, an approval's binding). */
  shown: string;
  labels: {
    approve: string;
    refuse: string;
    reason: string;
    reasonHint: string;
    /** When set, Approve waits until the person ticks this; Refuse never waits. */
    acknowledge?: string;
  };
  /** What the kind shows of the request, inside the form, above the answer. */
  children?: React.ReactNode;
}

/**
 * A person's answer on a step's page, for every kind decided there: an
 * optional reason, Refuse, then Approve. It posts, same-origin, to the
 * step's `decide` route the answer, the reason, the revision and the digest
 * of what the page showed, so the answer decides what the person read and
 * nothing else. A kind may ask for a deliberate step before approving (a
 * box to tick): a tap on Approve alone then does nothing.
 */
export const HandoffDecisionForm = ({
  action,
  revision,
  shown,
  labels,
  children,
}: HandoffDecisionFormProps) => {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <form method="post" action={action} className="w-full space-y-4">
      {children}
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="shown" value={shown} />
      <div className="space-y-2">
        <Label htmlFor="handoff-reason">{labels.reason}</Label>
        <Textarea
          id="handoff-reason"
          name="reason"
          maxLength={DECISION_REASON_MAX}
          rows={2}
          aria-describedby="handoff-reason-hint"
        />
        <p id="handoff-reason-hint" className="text-muted-foreground text-xs">
          {labels.reasonHint}
        </p>
      </div>
      {labels.acknowledge && (
        <Label className="items-start font-normal">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(checked) => setAcknowledged(checked === true)}
            className="mt-0.5"
          />
          <span>{labels.acknowledge}</span>
        </Label>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="submit"
          name="decision"
          value="refuse"
          variant="outline"
          className="w-full sm:w-auto"
        >
          {labels.refuse}
        </Button>
        <Button
          type="submit"
          name="decision"
          value="approve"
          disabled={labels.acknowledge !== undefined && !acknowledged}
          className="w-full sm:w-auto"
        >
          {labels.approve}
        </Button>
      </div>
    </form>
  );
};
