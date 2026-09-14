import { cn } from "@louez/utils";

interface SketchBarProps {
  /** Size and colour: a width, a height, a fill class. */
  className?: string;
}

/** A line of text that is not written out: a rounded bar the size the text would take. */
export const SketchBar = ({ className }: SketchBarProps) => (
  <div aria-hidden className={cn("h-3 w-24 shrink-0 rounded-full", className)} />
);
