import { cn } from "@louez/utils";

import { SketchBar } from "./sketch-bar";
import type { SketchPalette } from "./sketch-palette";

interface SketchContactRowProps {
  palette: SketchPalette;
  icon: React.ComponentType<{ className?: string }>;
  text: string;
  note?: string | null;
}

/** One contact row at its real size: a round icon, a small label, the value, an optional tag. */
export const SketchContactRow = ({ palette: p, icon: Icon, text, note }: SketchContactRowProps) => (
  <div className="flex items-center gap-4">
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full",
        p.fillSoft,
        p.icon,
      )}
    >
      <Icon className="size-4" />
    </span>
    <span className="flex min-w-0 flex-col gap-1.5">
      <SketchBar className={cn("h-2.5 w-12", p.inkSoft)} />
      <span className="flex items-center gap-2">
        <span className={cn("truncate text-base", p.text)}>{text}</span>
        {note ? (
          <span className={cn("shrink-0 rounded-md px-1.5 text-xs", p.fillSoft, p.textSoft)}>
            {note}
          </span>
        ) : null}
      </span>
    </span>
  </div>
);
