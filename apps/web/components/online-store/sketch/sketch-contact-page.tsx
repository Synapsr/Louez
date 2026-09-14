import { MessageCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { MailIcon, MapPinIcon, PhoneCallIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { resolveStoreContactChannels } from "@/lib/storefront/util.store-contact";

import type { OnlineStoreDevice } from "../online-store.constants";
import { type OnlineStoreContactValues, getContrastColor } from "../util.online-store-form";
import { SketchBar } from "./sketch-bar";
import { SketchContactRow } from "./sketch-contact-row";
import type { SketchPalette } from "./sketch-palette";

interface SketchContactPageProps {
  palette: SketchPalette;
  device: OnlineStoreDevice;
  name: string;
  contact: OnlineStoreContactValues;
  primaryColor: string;
}

const ICONS = {
  phone: PhoneCallIcon,
  whatsapp: MessageCircleIcon,
  email: MailIcon,
} as const;

const HOURS_ROWS = [0, 1, 2, 3] as const;

/**
 * The contact page at its real sizes, redrawn from the form: the channels
 * that would really show (a toggled channel with no store field stays out,
 * as on the page), the form with its fields, the big action of a
 * single-channel page, the hours and the map.
 */
export const SketchContactPage = ({
  palette: p,
  device,
  name,
  contact,
  primaryColor,
}: SketchContactPageProps) => {
  const t = useTranslations("storefront.footer");
  const phone = device === "phone";
  const onPrimary = getContrastColor(primaryColor) === "white" ? "#ffffff" : "#09090b";
  const channels = resolveStoreContactChannels({
    email: contact.email,
    phone: contact.phone,
    settings: {
      reservationMode: "payment",
      advanceNoticeMinutes: 0,
      contact: {
        ...contact.channels,
        whatsappNumber: contact.channels.whatsappNumber || null,
        formRecipientEmail: contact.channels.formRecipientEmail || null,
        intro: contact.channels.intro || null,
      },
    },
  });
  const address = contact.address.trim();
  const intro = contact.channels.intro.trim();
  const gutter = phone ? "px-4 py-8" : "px-8 py-12";

  const header = (
    <div className="flex flex-col gap-3">
      <SketchBar className={cn("h-3 w-16", p.inkSoft)} />
      <h1 className={cn("font-semibold tracking-tight", phone ? "text-2xl" : "text-3xl", p.text)}>
        {t("contact")} · {name}
      </h1>
      {intro ? (
        <p className={cn("max-w-prose text-base", p.textSoft)}>{intro}</p>
      ) : (
        <SketchBar className={cn("h-3.5 w-2/3 max-w-md", p.inkSoft)} />
      )}
    </div>
  );

  const rows = (
    <div className="flex flex-col gap-4">
      {address ? <SketchContactRow palette={p} icon={MapPinIcon} text={address} /> : null}
      {channels.phone ? (
        <SketchContactRow
          palette={p}
          icon={PhoneCallIcon}
          text={channels.phone}
          note={channels.sms ? "SMS" : null}
        />
      ) : null}
      {channels.whatsapp ? (
        <SketchContactRow palette={p} icon={MessageCircleIcon} text="WhatsApp" />
      ) : null}
      {channels.email ? (
        <SketchContactRow palette={p} icon={MailIcon} text={channels.email} />
      ) : null}
    </div>
  );

  const field = (className?: string) => (
    <div className={cn("h-11 rounded-lg border", p.line, className)} />
  );

  const form = channels.form ? (
    <div className={cn("flex flex-col gap-4 rounded-2xl border p-6", p.line, p.surface)}>
      <SketchBar className={cn("h-4 w-40", p.ink)} />
      <div className={cn("grid gap-4", phone ? "grid-cols-1" : "grid-cols-2")}>
        {field()}
        {field()}
      </div>
      {field()}
      {channels.form.phoneField === "hidden"
        ? null
        : field(channels.form.phoneField === "required" ? undefined : "border-dashed")}
      <div className={cn("h-32 rounded-lg border", p.line)} />
      <div
        className="flex h-11 w-44 items-center justify-center rounded-lg transition-colors duration-300"
        style={{ backgroundColor: primaryColor, color: onPrimary }}
      >
        <SketchBar className="h-3 w-24 bg-current opacity-80" />
      </div>
    </div>
  ) : null;

  const hours = (
    <div className={cn("flex flex-col gap-3 rounded-2xl border p-5", p.line, p.surface)}>
      <SketchBar className={cn("h-3.5 w-24", p.ink)} />
      <div className="flex flex-col gap-2">
        {HOURS_ROWS.map((row) => (
          <div key={row} className="flex justify-between gap-4">
            <SketchBar className={cn("h-3 w-20", p.inkSoft)} />
            <SketchBar className={cn("h-3 w-28", p.inkSoft)} />
          </div>
        ))}
      </div>
    </div>
  );

  const map = address ? (
    <div
      className={cn(
        "flex h-64 items-center justify-center rounded-2xl transition-colors duration-300",
        p.fillSoft,
      )}
    >
      <MapPinIcon className="size-10" style={{ color: primaryColor }} />
    </div>
  ) : null;

  const aside = (direction: "row" | "column") => (
    <div
      className={cn(
        direction === "row" && !phone ? "grid grid-cols-2 gap-6" : "flex flex-col gap-6",
      )}
    >
      {hours}
      {map}
    </div>
  );

  if (channels.layout === "single" && channels.primary) {
    const Icon = ICONS[channels.primary.kind];
    return (
      <div
        className={cn("mx-auto flex w-full max-w-5xl flex-col gap-10", gutter)}
        data-slot="sketch-contact"
      >
        <div className={cn("mx-auto flex w-full flex-col gap-8", phone ? "" : "max-w-xl")}>
          {header}
          <div
            className={cn(
              "flex flex-col items-center gap-3 rounded-2xl px-6 py-8 text-center transition-colors duration-300",
              p.fillSoft,
            )}
          >
            <span
              className={cn("flex size-14 items-center justify-center rounded-full", p.surface)}
              style={{ color: primaryColor }}
            >
              <Icon className="size-6" />
            </span>
            <SketchBar className={cn("h-5 w-40", p.ink)} />
            {channels.primary.kind === "whatsapp" ? null : (
              <p className={cn("text-base", p.textSoft)}>{channels.primary.value}</p>
            )}
            <div
              className="mt-1 flex h-11 w-48 items-center justify-center rounded-lg transition-colors duration-300"
              style={{ backgroundColor: primaryColor, color: onPrimary }}
            >
              <SketchBar className="h-3 w-24 bg-current opacity-80" />
            </div>
          </div>
          {form}
        </div>
        {aside("row")}
      </div>
    );
  }

  if (channels.layout === "message" && channels.form) {
    return (
      <div
        className={cn("mx-auto flex w-full max-w-5xl flex-col gap-10", gutter)}
        data-slot="sketch-contact"
      >
        <div className={cn("mx-auto flex w-full flex-col gap-8", phone ? "" : "max-w-xl")}>
          {header}
          {form}
          {channels.email ? (
            <p className={cn("flex items-center gap-2 text-sm", p.textSoft)}>
              <SketchBar className={cn("h-3 w-32", p.inkSoft)} />
              <span className={cn("underline underline-offset-4", p.text)}>{channels.email}</span>
            </p>
          ) : null}
        </div>
        {aside("row")}
      </div>
    );
  }

  return (
    <div
      className={cn("mx-auto flex w-full max-w-5xl flex-col gap-8", gutter)}
      data-slot="sketch-contact"
    >
      {header}
      <div
        className={cn(
          "grid gap-8",
          form && !phone ? "grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-12" : "grid-cols-1",
        )}
      >
        <div className="flex flex-col gap-8">
          {rows}
          {aside("column")}
        </div>
        {form}
      </div>
    </div>
  );
};
