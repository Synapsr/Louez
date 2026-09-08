import { cn } from "@louez/utils";

import type { StoreHeroLayout } from "@/lib/utils/util.store-hero";

interface HeroLayoutSketchProps {
  layout: StoreHeroLayout;
  className?: string;
}

/** A thumbnail of one hero layout: where the photo goes, where the text goes. */
export const HeroLayoutSketch = ({ layout, className }: HeroLayoutSketchProps) => (
  <div
    aria-hidden
    className={cn(
      "flex aspect-[16/9] w-full overflow-hidden rounded-md border bg-background p-1.5",
      className,
    )}
  >
    {layout === "cover" ? (
      <div className="relative flex flex-1 items-end overflow-hidden rounded-sm bg-linear-to-t from-foreground/70 via-foreground/25 to-muted-foreground/30 p-1.5">
        <div className="flex w-1/2 flex-col gap-1">
          <div className="h-1.5 w-3/5 rounded-full bg-background" />
          <div className="h-1 w-full rounded-full bg-background/70" />
          <div className="mt-0.5 h-3 w-full rounded-sm bg-background" />
        </div>
      </div>
    ) : (
      <div className="grid flex-1 grid-cols-2 gap-1.5">
        <div className="flex flex-col justify-center gap-1 pl-0.5">
          <div className="h-1.5 w-3/5 rounded-full bg-foreground/80" />
          <div className="h-1 w-full rounded-full bg-muted-foreground/50" />
          <div className="mt-0.5 h-3 w-full rounded-sm border bg-card" />
        </div>
        <div className="rounded-sm bg-linear-to-br from-muted-foreground/40 to-muted-foreground/20" />
      </div>
    )}
  </div>
);
