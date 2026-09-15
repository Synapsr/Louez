"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@louez/ui";
import { CheckIcon } from "@louez/ui/icons";
import { ProductCard } from "@/components/storefront/product/product-card";
import { QuickAddDialogView } from "@/components/storefront/product/quick-add-dialog-view";
import { QuickAddVariantView } from "@/components/storefront/product/quick-add-variant-view";
import { useProductCardPricing } from "@/components/storefront/product/use-product-card-pricing";
import { RentalPeriodPicker } from "@/components/storefront/date-picker/rental-period-picker";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { DEMO_PRODUCTS, DEMO_RULES, type DemoBooking } from "@/lib/landing-demos/fixtures";

export const StorefrontScene = ({
  compact,
  period: initialPeriod,
  onComplete,
}: {
  compact: boolean;
  period: RentalPeriodValue;
  onComplete: (booking: DemoBooking) => void;
}) => {
  const t = useTranslations("storefront");
  const [period, setPeriod] = useState(initialPeriod);
  const [productIndex, setProductIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [added, setAdded] = useState(false);
  const product = DEMO_PRODUCTS[productIndex] ?? DEMO_PRODUCTS[0];
  const cardPeriod = { startDate: period.start.toISOString(), endDate: period.end.toISOString() };
  const pricing = useProductCardPricing(product, cardPeriod);
  const choose = (index: number) => {
    setProductIndex(index);
    setQuantity(1);
    setSelected({});
    setAdded(false);
    setOpen(true);
  };
  return (
    <div className="flex flex-col gap-5" data-demo-scene="storefront">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">Maison du Vélo</span>
        <RentalPeriodPicker
          layout="compact"
          value={period}
          onChange={setPeriod}
          rules={DEMO_RULES}
        />
      </div>
      <div
        className={
          compact ? "mx-auto w-full max-w-44" : "grid grid-cols-2 gap-4 min-[520px]:grid-cols-3"
        }
      >
        {(compact ? DEMO_PRODUCTS.slice(0, 1) : DEMO_PRODUCTS).map((item, index) => (
          <div
            key={item.id}
            data-demo-target={`product-${index}`}
            onClickCapture={(event) => {
              if (event.target instanceof Element && event.target.closest("a")) {
                event.preventDefault();
                choose(index);
              }
            }}
          >
            <ProductCard
              product={item}
              href="/demos/landing/storefront"
              period={cardPeriod}
              onQuickAdd={() => choose(index)}
            />
          </div>
        ))}
      </div>
      {added && (
        <Badge variant="success" className="self-center" role="status">
          <CheckIcon />
          {t("accessories.productAdded")}
        </Badge>
      )}
      <QuickAddDialogView
        autoFocus={false}
        modal={false}
        isOpen={open}
        step="variant"
        steps={["variant"]}
        productName={product.name}
        onDismiss={() => setOpen(false)}
      >
        <div data-demo-target="options">
          <QuickAddVariantView
            product={product}
            pricing={pricing}
            axes={product.bookingAttributeAxes ?? []}
            values={{ size: ["S", "M", "L"] }}
            selected={selected}
            onSelectedChange={setSelected}
            quantity={quantity}
            maxQuantity={product.quantity}
            onQuantityChange={setQuantity}
            isChecking={false}
            disabled={false}
            onConfirm={() => {
              setOpen(false);
              setAdded(true);
              onComplete({ productIndex, quantity, selected, period, unitPrice: pricing.amount });
            }}
          />
        </div>
      </QuickAddDialogView>
    </div>
  );
};
