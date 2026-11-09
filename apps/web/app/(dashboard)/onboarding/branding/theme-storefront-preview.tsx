import { cn } from "@louez/utils";

import { rgba } from "../_lib/util.preview-color";

interface ThemeStorefrontPreviewProps {
  theme: "light" | "dark";
  primaryColor: string;
}

/**
 * Thumbnail of the storefront in one theme, in the store colour: the choice is
 * about what customers see, so the card shows a storefront, not the back office.
 */
export const ThemeStorefrontPreview = ({ theme, primaryColor }: ThemeStorefrontPreviewProps) => {
  const isDark = theme === "dark";

  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-19 flex-col gap-1.5 rounded-lg p-2",
        isDark ? "bg-zinc-950" : "bg-white shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)]",
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn("h-1.5 w-8 rounded-full", isDark ? "bg-white/15" : "bg-black/10")} />
        <span
          className="h-2 w-5 rounded-sm transition-colors duration-500"
          style={{ backgroundColor: primaryColor }}
        />
      </div>
      <div className="grid flex-1 grid-cols-3 gap-1">
        {["a", "b", "c"].map((key) => (
          <span
            key={key}
            className="rounded-sm transition-colors duration-500"
            style={{ backgroundColor: rgba(primaryColor, isDark ? 0.28 : 0.16) }}
          />
        ))}
      </div>
    </div>
  );
};
