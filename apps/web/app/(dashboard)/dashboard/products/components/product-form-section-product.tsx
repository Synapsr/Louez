"use client";

import { useTranslations } from "next-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@louez/ui";

import { ProductInfoFields, type ProductInfoFieldsProps } from "./product-info-fields";
import { ProductMediaFields, type ProductMediaFieldsProps } from "./product-media-fields";

type ProductFormSectionProductProps = ProductInfoFieldsProps &
  Omit<ProductMediaFieldsProps, "showPhotosLabel">;

export function ProductFormSectionProduct(props: ProductFormSectionProductProps) {
  const t = useTranslations("dashboard.products.form");

  return (
    <Card className="">
      <CardHeader>
        <CardTitle>{t("productSection")}</CardTitle>
        <CardDescription>{t("productSectionDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ProductInfoFields
          form={props.form}
          categories={props.categories}
          onCreateCategory={props.onCreateCategory}
          isCreatingCategory={props.isCreatingCategory}
          onNameInputChange={props.onNameInputChange}
        />

        <ProductMediaFields
          form={props.form}
          imagesPreviews={props.imagesPreviews}
          isDragging={props.isDragging}
          isUploadingImages={props.isUploadingImages}
          handleImageUpload={props.handleImageUpload}
          handleDragOver={props.handleDragOver}
          handleDragEnter={props.handleDragEnter}
          handleDragLeave={props.handleDragLeave}
          handleDrop={props.handleDrop}
          removeImage={props.removeImage}
          setMainImage={props.setMainImage}
          recropImage={props.recropImage}
          canRecrop={props.canRecrop}
          showPhotosLabel
        />
      </CardContent>
    </Card>
  );
}
