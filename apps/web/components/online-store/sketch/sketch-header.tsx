import {
  ArrowLeftIcon,
  CalendarIcon,
  PhoneIcon,
  SearchIcon,
  ShoppingBagIcon,
  UserIcon,
} from "lucide-react";

import { cn } from "@louez/utils";

import type { OnlineStoreDevice } from "../online-store.constants";
import { getContrastColor } from "../util.online-store-form";
import { SketchBar } from "./sketch-bar";
import type { SketchPalette } from "./sketch-palette";

interface SketchHeaderProps {
  palette: SketchPalette;
  device: OnlineStoreDevice;
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  /** A call button beside the cart, when the store asked for one and has a phone. */
  showPhone: boolean;
  /** A "back to the website" pill before the logo, when the store has its own site. */
  websiteUrl: string | null;
}

/**
 * The store header at its real sizes: the back-to-website pill, logo or
 * name, the search capsule (centred on desktop, under the logo row on a
 * phone), the call button, the cart and the account pill.
 */
export const SketchHeader = ({
  palette: p,
  device,
  name,
  logoUrl,
  primaryColor,
  showPhone,
  websiteUrl,
}: SketchHeaderProps) => {
  const phone = device === "phone";
  const onPrimary = getContrastColor(primaryColor) === "white" ? "#ffffff" : "#09090b";

  const logo = (
    <>
      {websiteUrl ? (
        <span
          className={cn(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-full border transition-colors duration-300",
            phone ? "w-9 justify-center" : "px-3",
            p.line,
            p.textSoft,
          )}
        >
          <ArrowLeftIcon className="size-4" />
          {phone ? null : <SketchBar className={cn("h-3 w-20", p.fill)} />}
        </span>
      ) : null}
      {logoUrl ? (
        <img src={logoUrl} alt="" className="h-9 w-auto max-w-32 object-contain" />
      ) : (
        <span className="truncate text-base font-semibold tracking-tight">{name}</span>
      )}
    </>
  );

  const capsule = (
    <div
      className={cn(
        "flex h-12 items-center rounded-full border p-0.5 transition-colors duration-300",
        p.line,
        p.surface,
        phone ? "w-full" : "w-full max-w-xl",
      )}
    >
      <div className="flex h-10 min-w-0 flex-1 items-center ps-4 pe-1">
        <SketchBar className={cn("h-3 w-36", p.fill)} />
      </div>
      <span aria-hidden className={cn("h-6 w-px shrink-0", p.fill)} />
      <div className={cn("flex h-10 shrink-0 items-center gap-2 px-3", p.textSoft)}>
        <CalendarIcon className="size-4" />
        <SketchBar className={cn("h-3 w-28", p.fill)} />
      </div>
      <span
        className="ms-1 flex size-10 shrink-0 items-center justify-center rounded-full transition-colors duration-300"
        style={{ backgroundColor: primaryColor, color: onPrimary }}
      >
        <SearchIcon className="size-4" />
      </span>
    </div>
  );

  const actions = (
    <div className="flex items-center gap-1">
      {showPhone ? (
        <span className={cn("flex size-12 items-center justify-center rounded-full", p.text)}>
          <PhoneIcon className="size-5" />
        </span>
      ) : null}
      <span
        className={cn("relative flex size-12 items-center justify-center rounded-full", p.text)}
      >
        <ShoppingBagIcon className="size-5" />
        <span
          className="absolute top-1.5 right-1.5 size-4 rounded-full transition-colors duration-300"
          style={{ backgroundColor: primaryColor }}
        />
      </span>
      <span
        className={cn(
          "flex h-12 items-center gap-2 rounded-full border px-1.5 transition-colors duration-300",
          phone ? "border-transparent" : cn(p.line, "ps-3"),
        )}
      >
        {phone ? null : <SketchBar className={cn("h-3 w-20", p.fill)} />}
        <span
          className="flex size-8 items-center justify-center rounded-full transition-colors duration-300"
          style={{ backgroundColor: primaryColor, color: onPrimary }}
        >
          <UserIcon className="size-4" />
        </span>
      </span>
    </div>
  );

  return (
    <div
      className={cn("border-b transition-colors duration-300", p.line, p.page)}
      data-slot="sketch-header"
    >
      {phone ? (
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex h-11 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">{logo}</div>
            {actions}
          </div>
          {capsule}
        </div>
      ) : (
        <div className="relative mx-auto flex h-18 w-full max-w-7xl items-center justify-between gap-3 px-8">
          <div className="flex min-w-0 items-center gap-3">{logo}</div>
          <div className="absolute top-1/2 left-1/2 w-full max-w-xl -translate-x-1/2 -translate-y-1/2">
            {capsule}
          </div>
          {actions}
        </div>
      )}
    </div>
  );
};
