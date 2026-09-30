"use client";

import Link from "next/link";

import { useTranslations } from "next-intl";
import { Boxes } from "lucide-react";

import { Badge, Button, Card, CardAction, CardContent, CardHeader, CardTitle } from "@louez/ui";
import type { StockKind } from "@louez/types";

import type { ProductInventoryDetail } from "../queries";
import { ProductUnitsTable } from "./product-units-table";

export interface ProductInventorySectionProps {
  productId: string;
  inventoryDetail: ProductInventoryDetail;
  stockKind: StockKind;
  readOnly?: boolean;
}

export const ProductInventorySectionView = ({
  productId,
  inventoryDetail,
  stockKind,
  readOnly = false,
}: ProductInventorySectionProps) => {
  const t = useTranslations("dashboard.products.detail.inventory");
  const isConsumable = stockKind === "consumable";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Boxes className="h-4 w-4" />
          {t("title")}
          {isConsumable ? (
            <Badge variant="expired" className="font-normal">
              {t("consumableBadge")}
            </Badge>
          ) : null}
        </CardTitle>
        <CardAction>
          <Button
            disabled={readOnly}
            variant="outline"
            size="sm"
            render={
              readOnly ? undefined : (
                <Link href={`/dashboard/products/${productId}/edit#section-stock`} />
              )
            }
          >
            {t("manageStock")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {inventoryDetail.mode === "simple" ? (
          <div className="flex items-center gap-8">
            <div>
              <p className="text-xs text-muted-foreground">
                {isConsumable ? t("consumableQuantity") : t("quantity")}
              </p>
              <p className="text-xl font-semibold">{inventoryDetail.quantity}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("available")}</p>
              <p className="text-xl font-semibold">{inventoryDetail.effectiveQuantity}</p>
            </div>
          </div>
        ) : (
          <ProductUnitsTable units={inventoryDetail.units} readOnly={readOnly} />
        )}
      </CardContent>
    </Card>
  );
};
