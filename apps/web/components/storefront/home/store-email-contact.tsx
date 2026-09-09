"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui/components/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@louez/ui/components/popover";
import { cn } from "@louez/utils";
import { ArrowUpRightIcon, CheckIcon, CopyIcon, MailIcon } from "@louez/ui/icons";

export const StoreEmailContact = ({
  email,
  iconClassName,
}: {
  email: string;
  /** Overrides the icon disc background when the surrounding surface is already muted. */
  iconClassName?: string;
}) => {
  const t = useTranslations("storefront.home");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const recipient = encodeURIComponent(email);
  const providers = [
    { name: "Gmail", href: `https://mail.google.com/mail/?view=cm&fs=1&to=${recipient}` },
    {
      name: "Outlook.com",
      href: `https://outlook.live.com/mail/0/deeplink/compose?to=${recipient}`,
    },
    {
      name: "Microsoft 365",
      href: `https://outlook.office.com/mail/deeplink/compose?to=${recipient}`,
    },
    { name: "Yahoo Mail", href: `https://compose.mail.yahoo.com/?to=${recipient}` },
  ];

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
          <MailIcon className="size-5" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{t("email")}</span>
          <span className="break-all text-sm font-medium sm:text-base">{email}</span>
        </span>
        <ArrowUpRightIcon
          aria-hidden
          className="mt-3.5 ml-auto size-4 shrink-0 text-muted-foreground transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100 sm:group-aria-expanded:opacity-100"
        />
      </PopoverTrigger>
      <PopoverPopup
        aria-label={t("email")}
        align="start"
        sideOffset={8}
        className="w-72 max-w-full rounded-2xl shadow-raised"
      >
        <div className="grid gap-0.5">
          {providers.map(({ name, href }) => (
            <a
              key={name}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted"
            >
              {name}
              <ArrowUpRightIcon aria-hidden className="size-4 text-muted-foreground" />
            </a>
          ))}
          <a
            href={`mailto:${email}`}
            className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted"
          >
            <MailIcon aria-hidden className="size-4 text-muted-foreground" />
            {t("emailContact.default")}
          </a>
          <div className="mt-1 border-t pt-1">
            <Button
              variant="ghost"
              className="min-h-11 w-full justify-start gap-3 rounded-xl px-3 text-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(email);
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
              {t(copyStatus === "copied" ? "emailContact.copySuccess" : "emailContact.copy")}
            </Button>
            <p role="status" className="px-3 text-xs text-muted-foreground">
              {copyStatus === "error"
                ? t("emailContact.copyError")
                : copyStatus === "copied"
                  ? t("emailContact.copySuccess")
                  : ""}
            </p>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
};
