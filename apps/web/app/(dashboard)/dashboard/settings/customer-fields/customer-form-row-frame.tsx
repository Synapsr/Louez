"use client";

import type { ReactNode, Ref } from "react";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

interface CustomerFormRowFrameProps {
  ref?: Ref<HTMLLIElement>;
  label: string;
  /** A Louez field always on the form: a lock after its name. */
  locked?: boolean;
  /** Its own row in the form: both columns. */
  full: boolean;
  /** Hidden: greyed in place, still there to be opened and shown again. */
  muted?: boolean;
  /** Open in the Sheet, or being created. */
  highlighted?: boolean;
  dragging?: boolean;
  /** The input, as the form shows it. */
  preview: ReactNode;
  badges?: ReactNode;
  /** The whole row opens the item. Absent for a row nothing opens. */
  action?: { label: string; onClick: () => void };
  /** Grip and width, in the corner: on hover or focus, always on touch screens. */
  tools?: ReactNode;
  /** A tag on the frame ("Nouveau"). */
  tag?: ReactNode;
}

/**
 * One item of the list, the same for every field: its name, its input as
 * the form draws it, and a line of badges when something is worth knowing.
 */
export const CustomerFormRowFrame = ({
  ref,
  label,
  locked = false,
  full,
  muted = false,
  highlighted = false,
  dragging = false,
  preview,
  badges,
  action,
  tools,
  tag,
}: CustomerFormRowFrameProps) => {
  const t = useTranslations("dashboard.settings.customerFields.builder.locked");

  return (
    <li
      ref={ref}
      className={cn(
        "group/row relative min-w-0 rounded-xl",
        full && "@md/grid:col-span-2",
        highlighted && "bg-primary/5 ring-2 ring-primary/40",
        dragging && "bg-card shadow-raised z-10",
      )}
    >
      {action && (
        <button
          type="button"
          aria-label={action.label}
          className="group-hover/row:bg-muted/60 focus-visible:ring-ring absolute inset-0 cursor-pointer rounded-xl outline-none transition-colors focus-visible:ring-2"
          onClick={action.onClick}
        />
      )}
      <div className="pointer-events-none relative flex min-w-0 flex-col gap-2 p-2.5">
        <p className="flex min-h-5 min-w-0 items-center gap-1.5 text-sm leading-5 font-medium">
          <span className={cn("truncate", muted && "text-muted-foreground")}>{label}</span>
          {locked && (
            <>
              <Lock aria-hidden className="text-muted-foreground size-3 shrink-0" />
              <span className="sr-only">{t("label")}</span>
            </>
          )}
        </p>
        <div className={cn("flex min-w-0 flex-col transition-opacity", muted && "opacity-50")}>
          {preview}
        </div>
        {badges}
      </div>
      {tools && (
        // A small floating bar under a mouse; on a touch screen, where it always shows, just the icons.
        <div className="bg-card shadow-xs/5 pointer-coarse:border-transparent pointer-coarse:bg-transparent pointer-coarse:shadow-none absolute end-1.5 top-1.5 flex items-center gap-0.5 rounded-lg border p-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
          {tools}
        </div>
      )}
      {tag}
    </li>
  );
};
