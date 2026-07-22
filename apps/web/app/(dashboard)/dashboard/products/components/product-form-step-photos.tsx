"use client";

import { ImageIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@louez/ui";

import { ProductMediaFields, type ProductMediaFieldsProps } from "./product-media-fields";

type ProductFormStepPhotosProps = Omit<ProductMediaFieldsProps, "showPhotosLabel">;

export function ProductFormStepPhotos(props: ProductFormStepPhotosProps) {
  const t = useTranslations("dashboard.products.form");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5" />
          {t("photos")}
        </CardTitle>
        <CardDescription>{t("photosDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ProductMediaFields {...props} showPhotosLabel={false} />
      </CardContent>
    </Card>
  );
}
