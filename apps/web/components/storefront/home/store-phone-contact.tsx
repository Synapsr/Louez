"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui/components/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@louez/ui/components/popover";
import { cn } from "@louez/utils";
import { ArrowUpRightIcon, CheckIcon, CopyIcon, PhoneCallIcon } from "@louez/ui/icons";

export const StorePhoneContact = ({
  phone,
  sms = true,
  iconClassName,
}: {
  phone: string;
  /** Whether the popover also offers an SMS to each number. */
  sms?: boolean;
  /** Overrides the icon disc background when the surrounding surface is already muted. */
  iconClassName?: string;
}) => {
  const t = useTranslations("storefront.home");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const numbers = [
    ...new Set(
      phone
        .split(/[/;,]+/)
        .map((number) => number.trim())
        .filter(Boolean),
    ),
  ];
  const providers = numbers.flatMap((number) => {
    const recipient = number.replace(/[^+\d]/g, "");
    const call = {
      name: numbers.length > 1 ? `${t("phoneContact.call")} · ${number}` : t("phoneContact.call"),
      href: `tel:${recipient}`,
    };
    if (!sms) return [call];
    return [
      call,
      {
        name: numbers.length > 1 ? `${t("phoneContact.sms")} · ${number}` : t("phoneContact.sms"),
        href: `sms:${recipient}`,
      },
    ];
  });

  return (
    <Popover onOpenChange={() => setCopyStatus("idle")}>
      <PopoverTrigger className="group flex min-h-11 w-full cursor-pointer items-start gap-3 rounded-2xl px-3 py-2 transition-colors hover:bg-muted/40 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span
          aria-hidden
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
            iconClassName,
          )}
        >
          <PhoneCallIcon className="size-5" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{t("phone")}</span>
          <span className="break-all text-sm font-medium sm:text-base">{phone}</span>
        </span>
        <ArrowUpRightIcon
          aria-hidden
          className="mt-3.5 ml-auto size-4 shrink-0 text-muted-foreground transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100 sm:group-aria-expanded:opacity-100"
        />
      </PopoverTrigger>
      <PopoverPopup
        aria-label={t("phone")}
        align="start"
        sideOffset={8}
        className="w-72 max-w-full rounded-2xl shadow-raised"
      >
        <div className="grid gap-0.5">
          {providers.map(({ name, href }) => (
            <a
              key={name}
              href={href}
              className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted"
            >
              {name}
              <ArrowUpRightIcon aria-hidden className="size-4 text-muted-foreground" />
            </a>
          ))}
          <div className="mt-1 border-t pt-1">
            <Button
              variant="ghost"
              className="min-h-11 w-full justify-start gap-3 rounded-xl px-3 text-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(phone);
                  setCopyStatus("copied");
                } catch {
                  setCopyStatus("error");
                }
              }}
            >
              {copyStatus === "copied" ? (
                <CheckIcon aria-hidden className="size-4" />
              ) : (
                <CopyIcon aria-hidden className="size-4" />
              )}
              {t(copyStatus === "copied" ? "phoneContact.copySuccess" : "phoneContact.copy")}
            </Button>
            <p role="status" className="px-3 text-xs text-muted-foreground">
              {copyStatus === "error"
                ? t("phoneContact.copyError")
                : copyStatus === "copied"
                  ? t("phoneContact.copySuccess")
                  : ""}
            </p>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
};
