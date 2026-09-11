import { useTranslations } from "next-intl";

import { ProductImage } from "@/components/product/product-image";
import { AccountCard } from "@/components/storefront/account/account-card";
import { InsuredProductShield } from "@/components/storefront/ui/insured-product-shield";
import { Price } from "@/components/storefront/ui/price";

export interface ReservationItemView {
  id: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  /** The breakage/theft coverage of this reservation applies to this product. */
  insured: boolean;
}

interface ReservationItemsCardProps {
  items: ReservationItemView[];
  subtotal: number;
  deposit: number;
  /** Where the deposit stands, in two words ("Held", "Charged"); null when unknown. */
  depositLabel: string | null;
  /** Damage fees charged on top of the rental, refunds subtracted. */
  damageFees: number;
  total: number;
  /** Paid toward the rental itself; deposits and damage fees never count. */
  amountPaid: number;
  /**
   * Nothing has been charged and the reservation is still live, so the amounts
   * below are what the rental will cost, not what the customer has paid.
   */
  isUnsettled: boolean;
  /** Customer notes typed at checkout, if any. */
  notes: string | null;
}

/**
 * Lines, then subtotal, deposit (separate: never in the total, but tagged
 * with its state), damage fees, total, what was paid and what remains.
 */
export const ReservationItemsCard = ({
  items,
  subtotal,
  deposit,
  depositLabel,
  damageFees,
  total,
  amountPaid,
  isUnsettled,
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
              <div className="flex items-center gap-1">
                <p className="truncate text-base font-medium leading-snug">{item.name}</p>
                {item.insured ? <InsuredProductShield label={t("insuredProductTooltip")} /> : null}
              </div>
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
            <dt className="text-muted-foreground">
              {t("deposit")}
              {depositLabel ? (
                <>
                  <span aria-hidden> · </span>
                  {depositLabel}
                </>
              ) : null}
            </dt>
            <dd>
              <Price amount={deposit} size="sm" />
            </dd>
          </div>
        ) : null}
        {damageFees > 0 ? (
          <div className="flex justify-between gap-4 text-destructive">
            <dt>{t("damageFees")}</dt>
            <dd>
              <Price amount={damageFees} size="sm" className="text-destructive" />
            </dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-4 border-t pt-2">
          <dt className="text-base font-medium">{t("total")}</dt>
          <dd>
            <Price amount={total} size="lg" tone="primary" />
          </dd>
        </div>
        {amountPaid > 0 ? (
          <div className="flex justify-between gap-4 text-success">
            <dt>{t("amountPaid")}</dt>
            <dd>
              <Price amount={amountPaid} size="sm" className="text-success" />
            </dd>
          </div>
        ) : null}
        {amountPaid > 0 && amountPaid < total ? (
          <div className="flex justify-between gap-4 text-warning">
            <dt>{t("remainingDue")}</dt>
            <dd>
              <Price amount={total - amountPaid} size="sm" className="text-warning" />
            </dd>
          </div>
        ) : null}
      </dl>

      {isUnsettled ? (
        <p className="text-xs text-muted-foreground">{t("nothingChargedYet")}</p>
      ) : null}

      {notes ? (
        <div className="rounded-lg bg-muted p-3">
          <p className="text-xs font-medium text-muted-foreground">{t("notes")}</p>
          <p className="mt-1 whitespace-pre-line text-sm">{notes}</p>
        </div>
      ) : null}
    </AccountCard>
  );
};
