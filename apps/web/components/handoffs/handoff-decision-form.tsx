import { DECISION_REASON_MAX } from "@louez/api/contracts/handoffs";
import { Button, Label, Textarea } from "@louez/ui";
import { cn } from "@louez/utils";

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
    /** When set, Approve submits only once the person ticked this; Refuse never waits. */
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
 * nothing else. A kind may ask for a box to be ticked before approving: a
 * native required checkbox, so the browser's own validation holds Approve
 * back, with or without JavaScript, and the route refuses an approval that
 * did not post it. Refuse skips that validation (`formNoValidate`). Approve
 * looks dimmed while the box is not ticked, and stays clickable.
 */
export const HandoffDecisionForm = ({
  action,
  revision,
  shown,
  labels,
  children,
}: HandoffDecisionFormProps) => (
  <form method="post" action={action} className="group w-full space-y-4">
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
      <Label htmlFor="handoff-acknowledged" className="items-start font-normal">
        <input
          id="handoff-acknowledged"
          type="checkbox"
          name="acknowledged"
          value="yes"
          required
          className="accent-primary mt-0.5 size-4 shrink-0"
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
        formNoValidate={labels.acknowledge ? true : undefined}
        className="w-full sm:w-auto"
      >
        {labels.refuse}
      </Button>
      <Button
        type="submit"
        name="decision"
        value="approve"
        className={cn(
          "w-full sm:w-auto",
          labels.acknowledge && "group-has-[:invalid]:opacity-60",
        )}
      >
        {labels.approve}
      </Button>
    </div>
  </form>
);
