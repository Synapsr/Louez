import { useTranslations } from "next-intl";

import {
  Button,
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@louez/ui";
import { StoreIcon } from "@louez/ui/icons";

import { StoreContactDetails } from "@/components/storefront/home/store-contact-details";

type CheckoutStorePausedDialogProps = {
  open: boolean;
  onClose: () => void;
  storeName?: string;
  storeEmail?: string | null;
  storePhone?: string | null;
};

/**
 * What a renter sees when the store's card gate refuses the booking (louez-billing
 * docs/api, README §8.4): a pause on the store's side, not a mistake of theirs, so a
 * calm dialog that offers the store's contacts, the storefront's own rows, instead of
 * an error to fix. Never says why (design §4.7).
 */
export const CheckoutStorePausedDialog = ({
  open,
  onClose,
  storeName,
  storeEmail,
  storePhone,
}: CheckoutStorePausedDialogProps) => {
  const t = useTranslations("storefront.checkout.storePaused");
  const tCommon = useTranslations("common");
  const email = storeEmail?.trim() || null;
  const phone = storePhone?.trim() || null;
  const reachable = email !== null || phone !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <DialogHeader className="gap-4">
          <span
            aria-hidden
            className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full"
          >
            <StoreIcon className="size-6" />
          </span>
          <div className="flex flex-col gap-2">
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>
              {storeName ? t("descriptionNamed", { storeName }) : t("description")}{" "}
              {reachable ? t("contactHint") : t("contactLater")}
            </DialogDescription>
          </div>
        </DialogHeader>
        {reachable && (
          <DialogPanel>
            <StoreContactDetails address={null} phone={phone} email={email} />
          </DialogPanel>
        )}
        <DialogFooter variant="bare">
          <DialogClose render={<Button variant="outline" />}>{tCommon("close")}</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
