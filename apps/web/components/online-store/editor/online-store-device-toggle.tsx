"use client";

import { useTranslations } from "next-intl";

import { MobileIcon, MonitorIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import type { OnlineStoreDevice } from "../online-store.constants";

interface OnlineStoreDeviceToggleProps {
  value: OnlineStoreDevice;
  onChange: (next: OnlineStoreDevice) => void;
  className?: string;
}

const DEVICES: { id: OnlineStoreDevice; icon: typeof MonitorIcon }[] = [
  { id: "desktop", icon: MonitorIcon },
  { id: "phone", icon: MobileIcon },
];

/** Desktop or phone: which viewport the sketch draws. */
export const OnlineStoreDeviceToggle = ({
  value,
  onChange,
  className,
}: OnlineStoreDeviceToggleProps) => {
  const t = useTranslations("dashboard.onlineStore.device");

  return (
    <div
      role="group"
      aria-label={t("label")}
      className={cn("flex items-center gap-0.5 rounded-lg bg-muted p-0.5", className)}
    >
      {DEVICES.map(({ id, icon: Icon }) => {
        const selected = id === value;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(id)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            <span className="hidden xl:inline">{t(id)}</span>
          </button>
        );
      })}
    </div>
  );
};
