"use client";

import { useCallback, useEffect, useRef } from "react";

import { useRouter } from "next/navigation";

import { revalidateLogic, useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { z } from "zod";

import {
  type BusinessType,
  type FleetSize,
  type ProductCategory,
  createProfileSchema,
} from "@louez/validations";

import { useAppForm } from "@/hooks/form/form";
import { useImageUpload } from "@/hooks/use-image-upload";

import { useOnboardingErrorToast } from "../_lib/onboarding-error-toast";
import { useOnboardingPreview } from "../_lib/preview-context";
import { updateUserProfile } from "../profile-actions";

interface ProfileFormValues {
  name: string;
  businessType: BusinessType | null;
  productCategory: ProductCategory | null;
  fleetSize: FleetSize | null;
  // Local object URL for a new photo, null when removed, initialImage when untouched.
  image: string | null;
}

interface UseProfileStepParams {
  initialName: string;
  initialImage: string | null;
  initialBusinessType: BusinessType | null;
  initialProductCategory: ProductCategory | null;
  initialFleetSize: FleetSize | null;
}

export const useProfileStep = ({
  initialName,
  initialImage,
  initialBusinessType,
  initialProductCategory,
  initialFleetSize,
}: UseProfileStepParams) => {
  const router = useRouter();
  const tValidation = useTranslations("validation");
  const showError = useOnboardingErrorToast();
  const { updatePreview } = useOnboardingPreview();
  const { uploadImage, deleteImage, isUploading } = useImageUpload("avatar");
  const selectedImageFile = useRef<File | null>(null);
  const localPreviewUrl = useRef<string | null>(null);

  const releaseLocalPreview = useCallback(() => {
    if (!localPreviewUrl.current) return;
    URL.revokeObjectURL(localPreviewUrl.current);
    localPreviewUrl.current = null;
  }, []);

  useEffect(() => releaseLocalPreview, [releaseLocalPreview]);

  const profileSchema = createProfileSchema(tValidation).extend({
    image: z.string().nullable(),
  });

  const mutation = useMutation({
    mutationFn: async (value: ProfileFormValues) => {
      let uploadedKey: string | null = null;

      try {
        let imageUrl: string | null | undefined =
          value.image === initialImage ? undefined : value.image;

        if (selectedImageFile.current) {
          const uploaded = await uploadImage(selectedImageFile.current);
          uploadedKey = uploaded.key;
          imageUrl = uploaded.url;
        }

        const result = await updateUserProfile({
          name: value.name,
          businessType: value.businessType,
          productCategory: value.productCategory,
          fleetSize: value.fleetSize,
          imageUrl,
        });
        if (result.error) {
          throw new Error(result.error);
        }

        if (initialImage && imageUrl !== undefined && imageUrl !== initialImage) {
          void deleteImage(initialImage).catch(() => undefined);
        }

        selectedImageFile.current = null;
        releaseLocalPreview();
        return result;
      } catch (error) {
        if (uploadedKey) {
          void deleteImage(uploadedKey).catch(() => undefined);
        }
        throw error;
      }
    },
  });

  const form = useAppForm({
    defaultValues: {
      name: initialName,
      businessType: initialBusinessType as BusinessType | null,
      productCategory: initialProductCategory as ProductCategory | null,
      fleetSize: initialFleetSize as FleetSize | null,
      image: initialImage,
    } as ProfileFormValues,
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    validators: { onSubmit: profileSchema },
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync(value);
        router.push("/onboarding");
      } catch (error) {
        showError(error);
      }
    },
  });

  const formValues = useStore(form.store, (s) => s.values);

  useEffect(() => {
    updatePreview({ userName: formValues.name, userImage: formValues.image });
  }, [formValues.name, formValues.image, updatePreview]);

  const handleImageSelected = useCallback(
    (file: File) => {
      releaseLocalPreview();
      const previewUrl = URL.createObjectURL(file);
      localPreviewUrl.current = previewUrl;
      selectedImageFile.current = file;
      form.setFieldValue("image", previewUrl);
    },
    [form, releaseLocalPreview],
  );

  const handleImageRemove = useCallback(() => {
    selectedImageFile.current = null;
    releaseLocalPreview();
    form.setFieldValue("image", null);
  }, [form, releaseLocalPreview]);

  return {
    form,
    handleImageSelected,
    handleImageRemove,
    isUploading,
  };
};
