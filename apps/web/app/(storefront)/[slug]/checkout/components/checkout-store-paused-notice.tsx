import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { MailIcon, PhoneCallIcon, StoreIcon } from "@louez/ui/icons";

type CheckoutStorePausedNoticeProps = {
  storeName?: string;
  storeEmail?: string | null;
  storePhone?: string | null;
};

/**
 * What a renter sees when the store's card gate refuses the booking (louez-billing
 * docs/api, README §8.4): a pause on the store's side, not a mistake of theirs, so a
 * calm card that offers the store's contacts instead of an error to fix. Never says why
 * (design §4.7).
 */
export const CheckoutStorePausedNotice = ({
  storeName,
  storeEmail,
  storePhone,
}: CheckoutStorePausedNoticeProps) => {
  const t = useTranslations("storefront.checkout.storePaused");
  const email = storeEmail?.trim() || null;
  const phone = storePhone?.trim() || null;

  return (
    <div role="status" className="bg-muted/40 mb-6 rounded-2xl border p-5 sm:p-6">
      <div className="flex gap-4">
        <span className="bg-background text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full border">
          <StoreIcon className="size-5" />
        </span>
        <div className="min-w-0 space-y-1.5">
          <p className="font-semibold">{t("title")}</p>
          <p className="text-muted-foreground text-sm">
            {storeName ? t("descriptionNamed", { storeName }) : t("description")}{" "}
            {email || phone ? t("contactHint") : t("contactLater")}
          </p>
          {(email || phone) && (
            <div className="flex flex-wrap gap-2 pt-2">
              {phone && (
                <Button
                  size="sm"
                  variant="outline"
                  render={<a href={`tel:${phone.replace(/[^\d+]/g, "")}`} />}
                >
                  <PhoneCallIcon />
                  {phone}
                </Button>
              )}
              {email && (
                <Button size="sm" variant="outline" render={<a href={`mailto:${email}`} />}>
                  <MailIcon />
                  {email}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
