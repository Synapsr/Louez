import type { StoreContactLayout } from "@louez/types";
import { cn } from "@louez/utils";

interface ContactLayoutSketchProps {
  layout: StoreContactLayout;
  className?: string;
}

const ROWS = ["a", "b", "c"] as const;

/** A thumbnail of one contact page shape: where the channels, the form and the big action go. */
export const ContactLayoutSketch = ({ layout, className }: ContactLayoutSketchProps) => (
  <div
    aria-hidden
    className={cn(
      "flex aspect-[16/9] w-full flex-col gap-1 overflow-hidden rounded-md border bg-background p-1.5",
      className,
    )}
  >
    <div className="h-1.5 w-2/5 rounded-full bg-foreground/80" />
    {layout === "full" ? (
      <div className="grid flex-1 grid-cols-[2fr_3fr] gap-1.5">
        <div className="flex flex-col gap-1">
          {ROWS.map((key) => (
            <div key={key} className="flex items-center gap-1">
              <div className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />
              <div className="h-1 flex-1 rounded-full bg-muted-foreground/50" />
            </div>
          ))}
          <div className="mt-auto h-3 rounded-sm bg-muted" />
        </div>
        <div className="flex flex-col gap-1 rounded-sm border bg-card p-1">
          <div className="grid grid-cols-2 gap-1">
            <div className="h-1.5 rounded-sm bg-muted" />
            <div className="h-1.5 rounded-sm bg-muted" />
          </div>
          <div className="h-1.5 rounded-sm bg-muted" />
          <div className="h-3 rounded-sm bg-muted" />
          <div className="h-1.5 w-1/3 rounded-sm bg-primary" />
        </div>
      </div>
    ) : layout === "message" ? (
      <div className="flex flex-1 flex-col items-center gap-1 px-4">
        <div className="flex w-full flex-col gap-1 rounded-sm border bg-card p-1">
          <div className="grid grid-cols-2 gap-1">
            <div className="h-1.5 rounded-sm bg-muted" />
            <div className="h-1.5 rounded-sm bg-muted" />
          </div>
          <div className="h-1.5 rounded-sm bg-muted" />
          <div className="h-3 rounded-sm bg-muted" />
          <div className="h-1.5 w-1/3 rounded-sm bg-primary" />
        </div>
        <div className="h-1 w-1/2 rounded-full bg-muted-foreground/40" />
      </div>
    ) : (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-sm bg-muted px-4">
        <div className="size-3 rounded-full bg-background" />
        <div className="h-1.5 w-1/2 rounded-full bg-foreground/80" />
        <div className="h-2 w-2/5 rounded-sm bg-primary" />
      </div>
    )}
  </div>
);
