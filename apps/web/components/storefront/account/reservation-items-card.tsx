import { useTranslations } from "next-intl";

import { ProductImage } from "@/components/product/product-image";
import { AccountCard } from "@/components/storefront/account/account-card";
import { Price } from "@/components/storefront/ui/price";

export interface ReservationItemView {
  id: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

interface ReservationItemsCardProps {
  items: ReservationItemView[];
  subtotal: number;
  deposit: number;
  total: number;
  totalPaid: number;
  /** Customer notes typed at checkout, if any. */
  notes: string | null;
}

/** Lines, then subtotal, deposit (separate: never in the total) and total. */
export const ReservationItemsCard = ({
  items,
  subtotal,
  deposit,
  total,
  totalPaid,
  notes,
}: ReservationItemsCardProps) => {
  const t = useTranslations("storefront.account");

  return (
    <AccountCard title={t("rentedItems")}>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3">
            <ProductImage
              src={item.imageUrl ?? undefined}
              alt={item.name}
              sizes="64px"
              containerClassName="w-16 shrink-0 rounded-lg bg-muted"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-medium leading-snug">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                {t("quantityLabel")}: {item.quantity}
              </p>
            </div>
            <Price amount={item.totalPrice} size="sm" />
          </li>
        ))}
      </ul>

      <dl className="flex flex-col gap-2 border-t pt-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{t("subtotalRental")}</dt>
          <dd>
            <Price amount={subtotal} size="sm" />
          </dd>
        </div>
        {deposit > 0 ? (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t("deposit")}</dt>
            <dd>
              <Price amount={deposit} size="sm" />
            </dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-4 border-t pt-2">
          <dt className="text-base font-medium">{t("total")}</dt>
          <dd>
            <Price amount={total} size="lg" tone="primary" />
          </dd>
        </div>
        {totalPaid > 0 ? (
          <div className="flex justify-between gap-4 text-success">
            <dt>{t("amountPaid")}</dt>
            <dd>
              <Price amount={totalPaid} size="sm" className="text-success" />
            </dd>
          </div>
        ) : null}
      </dl>

      {notes ? (
        <div className="rounded-lg bg-muted p-3">
          <p className="text-xs font-medium text-muted-foreground">{t("notes")}</p>
          <p className="mt-1 whitespace-pre-line text-sm">{notes}</p>
        </div>
      ) : null}
    </AccountCard>
  );
};
