import { MailIcon, MapPinIcon, PhoneIcon } from "lucide-react";

import { STORE_SOCIAL_NETWORKS, type StoreSocialNetwork } from "@louez/types";
import { cn } from "@louez/utils";

import { SocialNetworkIcon } from "@/components/shared/social-network-icon";

import type { OnlineStoreDevice } from "../online-store.constants";
import type { OnlineStoreContactValues } from "../util.online-store-form";
import { SketchBar } from "./sketch-bar";
import type { SketchPalette } from "./sketch-palette";

interface SketchFooterProps {
  palette: SketchPalette;
  device: OnlineStoreDevice;
  name: string;
  contact: OnlineStoreContactValues;
  social: Record<StoreSocialNetwork, string>;
  footerNote: string;
}

/** Link columns: the number of rows each one holds on the real footer. */
const LINK_COLUMNS = [4, 2, 2] as const;

/**
 * The footer band at its real sizes: the store column with its contact
 * rows and social icons, three link columns, then the bottom row with the
 * note, the copyright and the language switcher.
 */
export const SketchFooter = ({
  palette: p,
  device,
  name,
  contact,
  social,
  footerNote,
}: SketchFooterProps) => {
  const phone = device === "phone";
  const networks = STORE_SOCIAL_NETWORKS.filter((network) => social[network].trim() !== "");
  const note = footerNote.trim();
  const rows = [
    { key: "email", icon: MailIcon, value: contact.email.trim() },
    { key: "phone", icon: PhoneIcon, value: contact.phone.trim() },
    { key: "address", icon: MapPinIcon, value: contact.address.trim() },
  ].filter((row) => row.value !== "");

  return (
    <div
      className={cn("transition-colors duration-300", phone ? "px-4 py-8" : "px-8 py-12", p.band)}
      data-slot="sketch-footer"
    >
      <div className="mx-auto w-full max-w-7xl">
        <div className={cn("grid gap-x-6 gap-y-8", phone ? "grid-cols-2" : "grid-cols-4")}>
          <div className={cn("flex flex-col gap-3", phone && "col-span-2")}>
            <span className={cn("truncate text-base font-semibold", p.text)}>{name}</span>
            <div className="flex flex-col">
              {rows.map(({ key, icon: Icon, value }) => (
                <span
                  key={key}
                  className={cn("flex min-h-9 items-center gap-2 text-sm", p.textSoft)}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{value}</span>
                </span>
              ))}
            </div>
            {networks.length > 0 ? (
              <div className={cn("-ms-2 flex flex-wrap", p.textSoft)}>
                {networks.map((network) => (
                  <span key={network} className="flex size-9 items-center justify-center">
                    <SocialNetworkIcon network={network} className="size-4" />
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {LINK_COLUMNS.map((count, column) => (
            <div key={column} className="flex flex-col gap-2">
              <SketchBar className={cn("h-2.5 w-20", p.ink)} />
              <div className="flex flex-col">
                {Array.from({ length: count }, (_, index) => (
                  <span key={index} className="flex min-h-9 items-center">
                    <SketchBar
                      className={cn("h-3", index % 2 === 0 ? "w-24" : "w-16", p.inkSoft)}
                    />
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div
          className={cn(
            "mt-8 flex gap-3 border-t pt-6 text-xs",
            phone ? "flex-col" : "flex-row items-center justify-between",
            p.line,
          )}
        >
          <div className="flex flex-col gap-2">
            {note ? <p className={cn("max-w-xl whitespace-pre-line", p.textSoft)}>{note}</p> : null}
            <SketchBar className={cn("h-2.5 w-48", p.inkSoft)} />
          </div>
          <div className="flex items-center gap-3">
            <SketchBar className={cn("h-2.5 w-8", p.inkSoft)} />
            <SketchBar className={cn("h-2.5 w-28", p.inkSoft)} />
          </div>
        </div>
      </div>
    </div>
  );
};
