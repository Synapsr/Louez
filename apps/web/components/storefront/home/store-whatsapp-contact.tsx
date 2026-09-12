import { MessageCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { ArrowUpRightIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

interface StoreWhatsAppContactProps {
  /** Digits only, as `wa.me` expects. */
  number: string;
  /** Overrides the icon disc background when the surrounding surface is already muted. */
  iconClassName?: string;
}

/** One row that opens a WhatsApp conversation with the store. */
export const StoreWhatsAppContact = ({ number, iconClassName }: StoreWhatsAppContactProps) => {
  const t = useTranslations("storefront.home");

  return (
    <a
      href={`https://wa.me/${number}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-h-11 items-start gap-3 rounded-2xl px-3 py-2 transition-colors hover:bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
          iconClassName,
        )}
      >
        <MessageCircleIcon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">WhatsApp</span>
        <span className="text-sm font-medium sm:text-base">{t("whatsappContact.open")}</span>
      </span>
      <ArrowUpRightIcon
        aria-hidden
        className="mt-3.5 ml-auto size-4 shrink-0 text-muted-foreground transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100"
      />
    </a>
  );
};
