import { MessageCircleIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Button } from "@louez/ui";
import { MailIcon, PhoneCallIcon } from "@louez/ui/icons";

import type { StoreContactPrimaryAction } from "@/lib/storefront/util.store-contact";

interface ContactPrimaryActionProps {
  action: StoreContactPrimaryAction;
}

const hrefFor = ({ kind, value }: StoreContactPrimaryAction): string => {
  switch (kind) {
    case "phone":
      return `tel:${value.replace(/[^+\d]/g, "")}`;
    case "whatsapp":
      return `https://wa.me/${value}`;
    case "email":
      return `mailto:${value}`;
  }
};

const ICONS = {
  phone: PhoneCallIcon,
  whatsapp: MessageCircleIcon,
  email: MailIcon,
} as const;

/** The one big thing to do on a single-channel contact page: call, write on WhatsApp, or email. */
export const ContactPrimaryAction = async ({ action }: ContactPrimaryActionProps) => {
  const t = await getTranslations("storefront.contact.primary");
  const Icon = ICONS[action.kind];
  const external = action.kind === "whatsapp";

  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl bg-muted px-6 py-10 text-center sm:py-14">
      <span
        aria-hidden
        className="flex size-16 items-center justify-center rounded-full bg-background text-primary"
      >
        <Icon className="size-7" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-xl font-semibold sm:text-2xl">{t(`${action.kind}.title`)}</p>
        {action.kind === "whatsapp" ? null : (
          <p className="break-all text-base text-muted-foreground sm:text-lg">{action.value}</p>
        )}
      </div>
      <Button
        size="xl"
        className="h-12 min-w-56"
        render={
          <a
            href={hrefFor(action)}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
          />
        }
      >
        {t(`${action.kind}.action`)}
      </Button>
    </div>
  );
};
