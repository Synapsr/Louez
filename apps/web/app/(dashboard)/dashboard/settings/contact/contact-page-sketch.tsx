import { MessageCircleIcon } from "lucide-react";

import { MailIcon, MapPinIcon, PhoneCallIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { resolveStoreContactChannels } from "@/lib/storefront/util.store-contact";

import type { ContactSettingsFormValues, ContactSettingsStore } from "./util.contact-settings-form";

interface ContactPageSketchProps {
  store: Pick<ContactSettingsStore, "name" | "email" | "phone" | "address">;
  values: ContactSettingsFormValues;
  className?: string;
}

const ICONS = {
  phone: PhoneCallIcon,
  whatsapp: MessageCircleIcon,
  email: MailIcon,
} as const;

const HOURS_ROWS = ["a", "b", "c"] as const;

/**
 * The contact page as a wireframe, redrawn from the form: the channels that
 * would really show (a toggled channel with no store field stays out, as on
 * the page), the form with its fields, the big action of a single-channel
 * page, the map and the hours. Real values where they carry meaning, bars
 * everywhere else.
 */
export const ContactPageSketch = ({ store, values, className }: ContactPageSketchProps) => {
  const channels = resolveStoreContactChannels({
    email: store.email,
    phone: store.phone,
    settings: {
      reservationMode: "payment",
      advanceNoticeMinutes: 0,
      contact: {
        ...values,
        whatsappNumber: values.whatsappNumber || null,
        formRecipientEmail: values.formRecipientEmail || null,
        intro: values.intro || null,
      },
    },
  });

  const header = (
    <div className="flex flex-col gap-1">
      <div className="h-1 w-6 rounded-full bg-zinc-300" />
      <p className="truncate font-semibold text-[11px] leading-tight text-zinc-900">{store.name}</p>
      <p className="line-clamp-1 text-[8px] leading-tight text-zinc-500">
        {values.intro.trim() || (
          <span className="inline-block h-1.5 w-3/4 rounded-full bg-zinc-200 align-middle" />
        )}
      </p>
    </div>
  );

  const rows = (
    <div className="flex flex-col gap-1">
      {store.address ? <SketchRow icon={MapPinIcon} text={store.address} /> : null}
      {channels.phone ? (
        <SketchRow icon={PhoneCallIcon} text={channels.phone} note={channels.sms ? "SMS" : null} />
      ) : null}
      {channels.whatsapp ? <SketchRow icon={MessageCircleIcon} text="WhatsApp" /> : null}
      {channels.email ? <SketchRow icon={MailIcon} text={channels.email} /> : null}
    </div>
  );

  const form = channels.form ? (
    <div className="flex flex-col gap-1 rounded-md border border-zinc-200 bg-white p-1.5">
      <div className="grid grid-cols-2 gap-1">
        <div className="h-2.5 rounded-sm border border-zinc-200" />
        <div className="h-2.5 rounded-sm border border-zinc-200" />
      </div>
      <div className="h-2.5 rounded-sm border border-zinc-200" />
      {channels.form.phoneField === "hidden" ? null : (
        <div
          className={cn(
            "h-2.5 rounded-sm border",
            channels.form.phoneField === "required"
              ? "border-zinc-300"
              : "border-dashed border-zinc-200",
          )}
        />
      )}
      <div className="h-5 rounded-sm border border-zinc-200" />
      <div className="h-2.5 w-1/3 rounded-sm bg-primary" />
    </div>
  ) : null;

  const aside = (direction: "row" | "column") => (
    <div className={cn(direction === "row" ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2")}>
      {store.address ? <div className="h-10 rounded-md bg-zinc-100" /> : null}
      <div className="flex flex-col gap-1">
        <div className="h-1.5 w-1/2 rounded-full bg-zinc-900" />
        {HOURS_ROWS.map((key) => (
          <div key={key} className="flex justify-between gap-2">
            <div className="h-1 w-1/3 rounded-full bg-zinc-300" />
            <div className="h-1 w-1/4 rounded-full bg-zinc-300" />
          </div>
        ))}
      </div>
    </div>
  );

  const shell = (children: React.ReactNode) => (
    <div
      aria-hidden
      className={cn(
        "flex flex-col gap-2 overflow-hidden rounded-xl border border-zinc-200 bg-white p-3 text-zinc-900",
        className,
      )}
      data-slot="contact-page-sketch"
    >
      <div className="flex h-4 items-center justify-between">
        <span className="truncate font-semibold text-[9px] leading-none">{store.name}</span>
        <div className="h-3 w-2/5 rounded-full border border-zinc-200" />
        <div className="h-3 w-6 rounded-full bg-zinc-200" />
      </div>
      {children}
    </div>
  );

  if (channels.layout === "single" && channels.primary) {
    const Icon = ICONS[channels.primary.kind];
    return shell(
      <>
        <div className="mx-auto flex w-4/5 flex-col gap-2">
          {header}
          <div className="flex flex-col items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-4">
            <span className="flex size-6 items-center justify-center rounded-full bg-white text-primary">
              <Icon className="size-3" />
            </span>
            <div className="h-2 w-1/2 rounded-full bg-zinc-900" />
            {channels.primary.kind === "whatsapp" ? null : (
              <p className="truncate text-[8px] leading-none text-zinc-500">
                {channels.primary.value}
              </p>
            )}
            <div className="mt-0.5 h-3.5 w-2/5 rounded-sm bg-primary" />
          </div>
          {form}
        </div>
        {aside("row")}
      </>,
    );
  }

  if (channels.layout === "message" && channels.form) {
    return shell(
      <>
        <div className="mx-auto flex w-4/5 flex-col gap-2">
          {header}
          {form}
          {channels.email ? (
            <p className="truncate text-[8px] leading-none text-zinc-500">
              <span className="inline-block h-1 w-8 rounded-full bg-zinc-300 align-middle" />{" "}
              <span className="text-zinc-900 underline">{channels.email}</span>
            </p>
          ) : null}
        </div>
        {aside("row")}
      </>,
    );
  }

  return shell(
    <>
      {header}
      <div className={cn("grid gap-2", form ? "grid-cols-[2fr_3fr]" : "grid-cols-1")}>
        <div className="flex flex-col gap-2">
          {rows}
          {aside("column")}
        </div>
        {form}
      </div>
    </>,
  );
};

interface SketchRowProps {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
  note?: string | null;
}

const SketchRow = ({ icon: Icon, text, note }: SketchRowProps) => (
  <div className="flex items-center gap-1.5">
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
      <Icon className="size-2" />
    </span>
    <span className="truncate text-[8px] leading-none text-zinc-900">{text}</span>
    {note ? (
      <span className="shrink-0 rounded-sm bg-zinc-100 px-1 text-[7px] leading-3 text-zinc-500">
        {note}
      </span>
    ) : null}
  </div>
);
