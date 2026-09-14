"use client";

import { type ReactNode, useId } from "react";

import { Badge } from "@louez/ui";
import { CheckIcon, InfoCircleIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

interface ProductFormChoiceCardProps {
  /** An 18px outline icon, shown in a tile beside the text. */
  icon: ReactNode;
  title: string;
  /** One line: the card stays short enough for a row of options to scan. */
  description: string;
  badge?: string;
  /** A small control right after the title and badge, such as an info popover. */
  titleInfo?: ReactNode;
  /** What choosing the card changes elsewhere, or why it is out of reach. Stays
   *  readable on a disabled card, since that is when it matters most. */
  note?: string;
  /** A button at the end of the card, centred on its height and above the
   *  card's click target, so it stays its own control. */
  action?: ReactNode;
  isCurrent?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  onSelect: () => void;
}

/**
 * One answer to a product-form question such as "how is the price computed?".
 * The whole card is the button. The icon tells the options apart at a glance;
 * examples live in a dialog by trade, so the card keeps to two short lines.
 */
export const ProductFormChoiceCard = ({
  icon,
  title,
  description,
  badge,
  titleInfo,
  note,
  action,
  isCurrent = false,
  disabled = false,
  invalid = false,
  onSelect,
}: ProductFormChoiceCardProps) => {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const noteId = `${id}-note`;

  return (
    <div
      className={cn(
        "bg-background relative flex gap-3 rounded-lg border px-3.5 py-3 transition-colors",
        !disabled && "hover:border-primary/48 hover:bg-accent/50",
        isCurrent && "border-primary/50 bg-accent/40",
        invalid &&
          "border-destructive/32 bg-destructive/4 hover:border-destructive/48 hover:bg-destructive/8",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-labelledby={titleId}
        aria-describedby={note ? `${descriptionId} ${noteId}` : descriptionId}
        aria-current={isCurrent || undefined}
        aria-invalid={invalid || undefined}
        className="focus-visible:ring-ring/50 absolute inset-0 rounded-lg outline-none focus-visible:ring-2 disabled:cursor-not-allowed"
      />

      <span
        aria-hidden
        className={cn(
          "bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
          isCurrent && "bg-primary/10 text-primary",
          disabled && "opacity-50",
        )}
      >
        {icon}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
          <p id={titleId} className={cn("text-sm font-semibold", disabled && "opacity-50")}>
            {title}
          </p>
          {badge ? (
            <Badge variant="expired" size="sm" className={cn(disabled && "opacity-50")}>
              {badge}
            </Badge>
          ) : null}
          {titleInfo ? <div className="relative z-10 flex">{titleInfo}</div> : null}
          {isCurrent ? <CheckIcon className="text-primary ms-auto size-4 shrink-0" /> : null}
        </div>
        <p
          id={descriptionId}
          className={cn("text-muted-foreground mt-0.5 text-xs", disabled && "opacity-50")}
        >
          {description}
        </p>
        {note ? (
          <p id={noteId} className="text-foreground mt-1.5 flex items-start gap-1.5 text-xs">
            <InfoCircleIcon className="text-info mt-px size-3.5 shrink-0" />
            {note}
          </p>
        ) : null}
      </div>

      {action ? <div className="relative z-10 flex shrink-0 self-center">{action}</div> : null}
    </div>
  );
};
