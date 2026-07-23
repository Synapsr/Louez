"use client";

import { GradientAvatar } from "@outpacelabs/avatars";

import { Avatar, AvatarFallback, AvatarImage, Logo } from "@louez/ui";
import { cn } from "@louez/utils";

import { useOnboardingPreview } from "../_lib/preview-context";

const navigationItems = [
  { key: "home", width: "w-24" },
  { key: "calendar", width: "w-28" },
  { key: "reservations", width: "w-32" },
  { key: "customers", width: "w-24" },
  { key: "products", width: "w-28" },
  { key: "inventory", width: "w-24" },
  // { key: 'analytics', width: 'w-32' },
  // { key: 'settings', width: 'w-20' },
] as const;

export const DashboardPreview = () => {
  const { preview } = useOnboardingPreview();
  const userName = preview.userName.trim();
  const userInitials = userName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return (
    <div className="bg-card relative h-144 overflow-hidden rounded-2xl border shadow-xs">
      <div className="bg-sidebar flex h-full grid-cols-[14rem_1fr] p-1">
        <div className="bg-sidebar text-sidebar-foreground flex min-w-0 flex-col p-1">
          <div className="flex h-12 items-center px-5">
            <Logo className="h-4 w-auto" />
          </div>

          <div className="border-b p-3">
            <div className="bg-sidebar-accent/60 flex items-center gap-3 rounded-lg px-3 py-2.5">
              <div className="bg-sidebar-foreground/10 size-8 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="bg-sidebar-foreground/15 h-2.5 w-24 rounded-full" />
                <div className="bg-sidebar-foreground/10 h-2 w-14 rounded-full" />
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-1 px-3 py-4" aria-hidden="true">
            {navigationItems.map(({ key, width }) => (
              <div key={key} className="flex h-9 items-center gap-3 px-3">
                <div className="bg-sidebar-foreground/8 size-4 shrink-0 rounded" />
                <div className={cn("bg-sidebar-foreground/8 h-2.5 rounded-full", width)} />
              </div>
            ))}
          </nav>

          <div className="border-t p-3">
            <div className="bg-sidebar-accent/70 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-300">
              <Avatar className="size-8 shrink-0">
                <AvatarImage src={preview.userImage || undefined} />
                <AvatarFallback className="relative overflow-hidden p-0">
                  <GradientAvatar seed={preview.userSeed} size={32} />
                  {userInitials && (
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white drop-shadow-sm">
                      {userInitials}
                    </span>
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                {userName ? (
                  <span className="block truncate text-xs font-medium transition-all duration-300">
                    {userName}
                  </span>
                ) : (
                  <div className="bg-sidebar-foreground/15 h-2.5 w-24 rounded-full" />
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-background min-w-0 overflow-y-auto rounded-2xl shadow-xs">
          <div className="flex h-16 items-center border-b px-6">
            <div className="bg-muted h-3 w-20 rounded-full" />
          </div>
          <div className="space-y-5 p-7">
            <div className="space-y-3">
              <div className="bg-muted h-4 w-44 rounded-full" />
              <div className="bg-muted/70 h-2.5 w-64 rounded-full" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              {["departures", "returns", "bookings"].map((item) => (
                <div key={item} className="h-24 rounded-xl border p-4">
                  <div className="bg-muted h-2.5 w-20 rounded-full" />
                  <div className="bg-muted mt-5 h-5 w-8 rounded-md" />
                </div>
              ))}
            </div>

            <div className="h-40 rounded-xl border p-5">
              <div className="bg-muted h-3 w-28 rounded-full" />
              <div className="mt-7 space-y-4">
                <div className="bg-muted/70 h-2.5 w-full rounded-full" />
                <div className="bg-muted/70 h-2.5 w-5/6 rounded-full" />
                <div className="bg-muted/70 h-2.5 w-2/3 rounded-full" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="h-28 rounded-xl border p-4">
                <div className="bg-muted h-3 w-24 rounded-full" />
                <div className="bg-muted/70 mt-5 h-2.5 w-3/4 rounded-full" />
              </div>
              <div className="h-28 rounded-xl border p-4">
                <div className="bg-muted h-3 w-20 rounded-full" />
                <div className="bg-muted/70 mt-5 h-2.5 w-2/3 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="from-background/85 via-background/35 pointer-events-none absolute inset-y-0 right-0 w-2/5 bg-linear-to-l to-transparent backdrop-blur-[1.5px]" />
    </div>
  );
};
