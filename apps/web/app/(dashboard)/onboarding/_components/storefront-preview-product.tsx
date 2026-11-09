import { cn } from "@louez/utils";

import { readableTextColor, rgba } from "../_lib/util.preview-color";
import { ProductPlaceholderArt, type ProductPlaceholderShape } from "./product-placeholder-art";

interface StorefrontPreviewProductProps {
  isDark: boolean;
  primaryColor: string;
  ctaLabel: string;
  /** A sample price, already formatted in the store's currency. */
  price: string;
  shape: ProductPlaceholderShape;
}

/** One product card of the onboarding storefront preview. */
export const StorefrontPreviewProduct = ({
  isDark,
  primaryColor,
  ctaLabel,
  price,
  shape,
}: StorefrontPreviewProductProps) => {
  const bar = isDark ? "bg-zinc-800" : "bg-zinc-200";

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border p-3 transition-colors duration-500",
        isDark ? "border-zinc-800 bg-zinc-950" : "border-zinc-200 bg-white",
      )}
    >
      <div
        className="aspect-4/3 overflow-hidden rounded-lg transition-colors duration-500"
        style={{ backgroundColor: rgba(primaryColor, isDark ? 0.16 : 0.08) }}
      >
        <ProductPlaceholderArt shape={shape} color={primaryColor} />
      </div>
      <div className="space-y-2 px-0.5">
        <div className={cn("h-2.5 w-3/4 rounded-full transition-colors duration-500", bar)} />
        <p
          className={cn(
            "text-xs font-semibold tabular-nums transition-colors duration-500",
            isDark ? "text-zinc-100" : "text-zinc-900",
          )}
        >
          {price}
        </p>
      </div>
      <div
        className="flex h-8 items-center justify-center rounded-lg text-xs font-medium transition-colors duration-500"
        style={{
          backgroundColor: primaryColor,
          color: readableTextColor(primaryColor),
        }}
      >
        {ctaLabel}
      </div>
    </div>
  );
};
