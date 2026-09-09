import { MapPin, Truck, CircleCheck, Clock } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ProductPageStore } from "@/lib/storefront/product-page.loader";

interface ProductRentalInformationProps {
  store: ProductPageStore;
}

export const ProductRentalInformation = ({ store }: ProductRentalInformationProps) => {
  const t = useTranslations("storefront.product.rentalInformation");
  const delivery = store.settings.delivery;
  const allowsPickup = !delivery?.enabled || delivery.mode === "optional";
  const ConfirmationIcon = store.reservationMode === "payment" ? CircleCheck : Clock;

  return (
    <ul className="flex flex-col gap-3 px-1 text-sm text-muted-foreground">
      {allowsPickup ? (
        <li className="flex items-start gap-2.5">
          <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium text-foreground">{t("pickup")}</p>
            <p>{store.address || store.name}</p>
            {delivery?.multiLocationEnabled ? <p className="text-xs">{t("locations")}</p> : null}
          </div>
        </li>
      ) : null}
      {delivery?.enabled ? (
        <li className="flex items-start gap-2.5">
          <Truck aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium text-foreground">{t(delivery.mode)}</p>
            <p className="text-xs">{t("deliveryDetails")}</p>
          </div>
        </li>
      ) : null}
      <li className="flex items-start gap-2.5">
        <ConfirmationIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p>{t(store.reservationMode)}</p>
      </li>
    </ul>
  );
};
