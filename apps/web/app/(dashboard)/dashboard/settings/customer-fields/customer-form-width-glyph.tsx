import type { CustomerFieldWidth } from "@louez/types";
import { cn } from "@louez/utils";

interface CustomerFormWidthGlyphProps {
  width: CustomerFieldWidth;
}

/** A row drawn as a bar, filled all the way or half way: what "full" and "half" look like. */
export const CustomerFormWidthGlyph = ({ width }: CustomerFormWidthGlyphProps) => (
  <span aria-hidden className="flex h-2.5 w-4 rounded-xs border border-current p-px">
    <span className={cn("rounded-xs bg-current", width === "half" ? "w-1/2" : "w-full")} />
  </span>
);
