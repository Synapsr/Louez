"use client";

import { useTranslations } from "next-intl";

import { Tooltip, TooltipContent, TooltipTrigger } from "@louez/ui";

import { ProductImage } from "@/components/product/product-image";

import type { HomeReservation } from "./home-types";

/** Rows the hover list shows before it sums up the rest. */
const LIST_MAX = 6;

interface ProductSummaryProps {
  items: HomeReservation["items"];
}

/**
 * A reservation's products in a few words: the first one, then "+ N more",
 * whose hover lists them all — photo, name and quantity, as the owner will
 * gather them.
 */
export const ProductSummary = ({ items }: ProductSummaryProps) => {
  const t = useTranslations("dashboard.home.today.agenda");
  const named = items.filter((item) => item.product?.name);
  const [first, ...rest] = named;
  if (!first) return null;

  const totalQuantity = named.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
  const listed = named.slice(0, LIST_MAX);
  const hidden = named.length - listed.length;

  return (
    <>
      <span className="truncate">{first.product?.name}</span>
      {rest.length > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="text-muted-foreground/70 hover:text-foreground shrink-0 cursor-default underline decoration-dotted underline-offset-2" />
            }
          >
            {t("moreProducts", { count: rest.length })}
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">
            <div className="flex w-64 flex-col gap-2 py-1.5 text-start">
              <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                {t("productsCount", { count: totalQuantity })}
              </p>
              <ul className="flex flex-col gap-1.5">
                {listed.map((item) => (
                  <li key={item.id} className="flex min-w-0 items-center gap-2">
                    <ProductImage
                      src={item.product?.images?.[0]}
                      alt=""
                      sizes="28px"
                      containerClassName="aspect-square size-7 shrink-0 rounded-md"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {item.product?.name}
                    </span>
                    {(item.quantity ?? 1) > 1 && (
                      <span className="text-muted-foreground shrink-0 font-mono tabular-nums">
                        ×{item.quantity}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {hidden > 0 && (
                <p className="text-muted-foreground border-t pt-1.5">
                  {t("moreProducts", { count: hidden })}
                </p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
};
