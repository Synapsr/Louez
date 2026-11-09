import { useCallback, useRef } from "react";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import type { ProductInput } from "@louez/validations";
import type { ProductImageHistory } from "@louez/types";

import { useImageUpload } from "@/hooks/use-image-upload";
import { apiErrorKey } from "@/lib/orpc/errors";
import { orpcClient } from "@/lib/orpc/client";
import { productsQueries } from "@/lib/queries/products.queries";

import { collectProductImageUrls } from "../utils/util.product-image-history";

interface UseProductFormMutationsParams {
  productId?: string;
  initialImages?: string[];
  initialImageHistory?: ProductImageHistory[];
}

export interface ProductActionErrorDetails {
  code?: string;
  duplicateRateTierIndexes?: number[];
}

/** The API error's code and details, when the save was refused. */
function errorData(error: unknown): { code?: string; details?: Record<string, unknown> } {
  const data = (error as { data?: unknown } | null)?.data;
  return data && typeof data === "object"
    ? (data as { code?: string; details?: Record<string, unknown> })
    : {};
}

export function useProductFormMutations({
  productId,
  initialImages = [],
  initialImageHistory = [],
}: UseProductFormMutationsParams) {
  const tErrors = useTranslations("errors");
  const { deleteImage } = useImageUpload("product");
  const persistedImagesRef = useRef(collectProductImageUrls(initialImages, initialImageHistory));

  const queryClient = useQueryClient();
  const productMutation = useMutation({
    mutationFn: async (value: ProductInput) => {
      const submittedImages = collectProductImageUrls(value.images ?? [], value.imageHistory ?? []);
      const persistedImages = persistedImagesRef.current;

      // A refused save throws: freshly uploaded files stay available for a
      // retry. The media hook deletes one when the user removes it from the
      // form; leaving the form keeps them (see use-product-form-media).
      const result = productId
        ? await orpcClient.dashboard.products.update({ ...value, id: productId })
        : await orpcClient.dashboard.products.create(value);
      void queryClient.invalidateQueries({ queryKey: productsQueries.key() });

      if (productId) {
        const removedImages = persistedImages.filter((image) => !submittedImages.includes(image));
        void Promise.allSettled(removedImages.map((image) => deleteImage(image)));
      }

      persistedImagesRef.current = submittedImages;
      return result;
    },
  });

  const getActionErrorMessage = useCallback(
    (error: unknown) => {
      // An input the contract refuses has no key of its own: invalid data.
      const key =
        apiErrorKey(error) ??
        ((error as { code?: unknown } | null)?.code === "BAD_REQUEST" ? "invalidData" : null);
      return key && tErrors.has(key) ? tErrors(key) : tErrors("generic");
    },
    [tErrors],
  );

  const getActionErrorDetails = useCallback(
    (error: unknown): ProductActionErrorDetails | undefined => {
      const { code, details } = errorData(error);
      if (code !== "PRODUCT_DUPLICATE_RATE_PERIODS") return undefined;
      const indexes = details?.duplicateRateTierIndexes;
      return {
        code: "duplicate_rate_periods",
        duplicateRateTierIndexes: Array.isArray(indexes) ? (indexes as number[]) : [],
      };
    },
    [],
  );

  const submitProduct = useCallback(
    async (value: ProductInput) => productMutation.mutateAsync(value),
    [productMutation],
  );
  const markImagesPersisted = useCallback(
    (images: string[], imageHistory: ProductImageHistory[] = []) => {
      persistedImagesRef.current = collectProductImageUrls(images, imageHistory);
    },
    [],
  );

  return {
    productMutation,
    isSaving: productMutation.isPending,
    submitProduct,
    markImagesPersisted,
    getActionErrorMessage,
    getActionErrorDetails,
  };
}
