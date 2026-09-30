import { Calendar, ChevronsUpDown, Plus } from "lucide-react";

import { cn } from "@louez/utils";

export type CustomerFormInputPreviewKind =
  | "text"
  | "textarea"
  | "select"
  | "date"
  | "switch"
  | "button";

interface CustomerFormInputPreviewProps {
  kind: CustomerFormInputPreviewKind;
  /** The form's own placeholder, or the button's text. */
  placeholder?: string;
  /** After a number, inside the input ("cm"). */
  unit?: string | null;
}

/** The input's frame, drawn with the tokens of `Input`: the row reads like the form. */
const FRAME =
  "border-input bg-background text-muted-foreground/72 flex w-full min-w-0 items-center gap-2 rounded-lg border px-3 text-sm shadow-xs/5 dark:bg-input/32";

/**
 * An empty input as the customer form draws it, only to be looked at: the
 * same frame whatever the field, with what tells its kind apart (a chevron
 * for a list, a calendar for a date, a switch for yes/no).
 */
export const CustomerFormInputPreview = ({
  kind,
  placeholder,
  unit,
}: CustomerFormInputPreviewProps) => {
  if (kind === "button") {
    return (
      <span className="border-border bg-background text-foreground dark:border-input dark:bg-input/30 inline-flex h-8 items-center gap-1 self-start rounded-lg border px-2.5 text-xs font-medium">
        <Plus aria-hidden className="size-4" />
        {placeholder}
      </span>
    );
  }

  if (kind === "textarea") {
    return (
      <span className={cn(FRAME, "h-16 items-start py-2")}>
        <span className="truncate">{placeholder}</span>
      </span>
    );
  }

  return (
    <span className={cn(FRAME, "h-9")}>
      <span className="min-w-0 flex-1 truncate">{placeholder}</span>
      {unit && <span className="text-muted-foreground shrink-0">{unit}</span>}
      {kind === "select" && <ChevronsUpDown aria-hidden className="size-4 shrink-0 opacity-72" />}
      {kind === "date" && <Calendar aria-hidden className="size-4 shrink-0 opacity-72" />}
      {kind === "switch" && (
        <span
          aria-hidden
          className="bg-input flex h-4 w-7 shrink-0 items-center rounded-full p-0.5"
        >
          <span className="bg-background size-3 rounded-full shadow-xs" />
        </span>
      )}
    </span>
  );
};
