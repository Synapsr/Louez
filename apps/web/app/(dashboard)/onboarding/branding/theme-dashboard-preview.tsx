"use client";

import { cn } from "@louez/utils";

interface ThemeDashboardPreviewProps {
  theme: "light" | "dark";
}

export const ThemeDashboardPreview = ({ theme }: ThemeDashboardPreviewProps) => {
  const isDark = theme === "dark";

  return (
    <div
      aria-hidden="true"
      className={cn(
        "aspect-video flex w-full overflow-hidden rounded-lg border p-2",
        isDark ? "border-zinc-700 bg-zinc-950" : "border-zinc-200 bg-white",
      )}
    >
      <div
        className={cn(
          "flex w-1/4 flex-col gap-2 border-r pr-2",
          isDark ? "border-zinc-800" : "border-zinc-200",
        )}
      >
        <div className={cn("h-2 w-3/5 rounded-full", isDark ? "bg-zinc-700" : "bg-zinc-300")} />
        <div className="space-y-1.5">
          <div
            className={cn("h-1.5 w-full rounded-full", isDark ? "bg-zinc-800" : "bg-zinc-200")}
          />
          <div className={cn("h-1.5 w-4/5 rounded-full", isDark ? "bg-zinc-800" : "bg-zinc-200")} />
          <div className={cn("h-1.5 w-3/5 rounded-full", isDark ? "bg-zinc-800" : "bg-zinc-200")} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 pl-2">
        <div className={cn("h-2 w-1/3 rounded-full", isDark ? "bg-zinc-700" : "bg-zinc-300")} />
        <div className="grid flex-1 grid-cols-2 gap-2">
          <div className={cn("rounded-sm", isDark ? "bg-zinc-900" : "bg-zinc-100")} />
          <div className={cn("rounded-sm", isDark ? "bg-zinc-900" : "bg-zinc-100")} />
        </div>
      </div>
    </div>
  );
};
