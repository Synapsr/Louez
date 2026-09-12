import { useTranslations } from "next-intl";
import { ArrowUpRightIcon, MapPinIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";
import { StoreEmailContact } from "@/components/storefront/home/store-email-contact";
import { StorePhoneContact } from "@/components/storefront/home/store-phone-contact";
import { StoreWhatsAppContact } from "@/components/storefront/home/store-whatsapp-contact";

interface StoreContactDetailsProps {
  address: string | null;
  phone: string | null;
  /** Whether the phone row also offers an SMS. */
  sms?: boolean;
  /** Digits of the WhatsApp number, or null when the store does not offer it. */
  whatsapp?: string | null;
  email: string | null;
  /** Overrides the icon disc background when the surrounding surface is already muted. */
  iconClassName?: string;
}

/** The store's ways of being reached, one tappable row each: address, phone, WhatsApp, email. */
export const StoreContactDetails = ({
  address,
  phone,
  sms = true,
  whatsapp = null,
  email,
  iconClassName,
}: StoreContactDetailsProps) => {
  const t = useTranslations("storefront.home");
  return (
    <ul className="-mx-3 flex flex-col gap-2">
      {address ? (
        <li>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}
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
              <MapPinIcon className="size-5" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{t("address")}</span>
              <span className="break-words text-sm font-medium sm:text-base">
                <span className="whitespace-pre-line">{address}</span>
              </span>
            </span>
            <ArrowUpRightIcon
              aria-hidden
              className="mt-3.5 ml-auto size-4 shrink-0 text-muted-foreground transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100"
            />
          </a>
        </li>
      ) : null}
      {phone ? (
        <li>
          <StorePhoneContact phone={phone} sms={sms} iconClassName={iconClassName} />
        </li>
      ) : null}
      {whatsapp ? (
        <li>
          <StoreWhatsAppContact number={whatsapp} iconClassName={iconClassName} />
        </li>
      ) : null}
      {email ? (
        <li>
          <StoreEmailContact email={email} iconClassName={iconClassName} />
        </li>
      ) : null}
    </ul>
  );
};
