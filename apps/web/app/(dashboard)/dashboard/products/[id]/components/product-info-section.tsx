import Link from "next/link";

import { getTranslations } from "next-intl/server";
import { FileText, Package } from "lucide-react";

import { Badge, Card, CardContent, CardHeader, CardTitle, Separator } from "@louez/ui";
import { formatCurrency } from "@louez/utils";

import { ProductImage } from "@/components/product/product-image";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils";

import { ProductImageGallery } from "./product-image-gallery";
import { ProductPricingTiersTable } from "./product-pricing-tiers-table";
import { sanitizeProductDescriptionHtml } from "@/lib/util.product-description";

interface ProductInfoSectionPricingTier {
  id: string;
  period: number | null;
  minDuration: number | null;
  discountPercent: string | null;
  price: string | null;
}

interface ProductInfoSectionSeasonalPricing {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  price: string;
}

interface ProductInfoSectionAccessory {
  id: string;
  accessory: {
    id: string;
    name: string;
    price: string;
    images: string[] | null;
  };
}

interface ProductInfoSectionProduct {
  description: string | null;
  price: string;
  pricingMode: "hour" | "day" | "week";
  images: string[] | null;
  pricingTiers: ProductInfoSectionPricingTier[];
  seasonalPricings: ProductInfoSectionSeasonalPricing[];
  accessories: ProductInfoSectionAccessory[];
}

interface ProductInfoSectionProps {
  product: ProductInfoSectionProduct;
  currency: string;
}

export async function ProductInfoSection({ product, currency }: ProductInfoSectionProps) {
  const t = await getTranslations("dashboard.products.detail.info");
  const tForm = await getTranslations("dashboard.products.form");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Description */}
        <div>
          {product.description ? (
            <div
              className="prose prose-sm dark:prose-invert prose-headings:text-foreground prose-a:text-primary prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-h1:text-xl prose-h2:text-lg prose-h3:text-base max-w-none text-sm text-muted-foreground wrap-break-word [&_a]:break-all **:min-w-0"
              dangerouslySetInnerHTML={{
                __html: sanitizeProductDescriptionHtml(product.description),
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("noDescription")}</p>
          )}
        </div>

        <Separator />

        {/* Pricing */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-lg font-semibold">
              {formatCurrency(parseFloat(product.price), currency)}
            </p>
            <Badge variant="expired">{tForm(`pricingModes.${product.pricingMode}`)}</Badge>
          </div>

          <ProductPricingTiersTable tiers={product.pricingTiers} currency={currency} />

          {product.seasonalPricings.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">{t("seasonalPricing")}</p>
              <ul className="space-y-1 text-sm">
                {product.seasonalPricings.map((season) => (
                  <li
                    key={season.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5"
                  >
                    <span className="min-w-0">
                      {season.name} · {formatDate(season.startDate)} – {formatDate(season.endDate)}
                    </span>
                    <span className="font-medium">
                      {formatCurrency(parseFloat(season.price), currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <Separator />

        {/* Accessories */}
        <div className="space-y-3">
          <p className="text-sm font-medium">{t("accessories")}</p>
          {product.accessories.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noAccessories")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {product.accessories.map((link) => {
                const accessoryImage = link.accessory.images?.[0];
                return (
                  <Link
                    key={link.id}
                    href={`/dashboard/products/${link.accessory.id}`}
                    className="group overflow-hidden rounded-lg border transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <ProductImage
                      src={accessoryImage}
                      alt={link.accessory.name}
                      sizes="120px"
                      inset={false}
                      className="transition-transform group-hover:scale-[1.02]"
                      containerClassName="w-full rounded-none"
                    />
                    <div className="p-2">
                      <p className="truncate text-xs font-medium">{link.accessory.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(parseFloat(link.accessory.price), currency)}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Image gallery */}
        {product.images && product.images.length > 0 && (
          <>
            <Separator />
            <ProductImageGallery images={product.images} />
          </>
        )}

        {product.images?.length === 0 && (
          <EmptyState icon={Package} title={t("noImages")} className="py-6" />
        )}
      </CardContent>
    </Card>
  );
}
