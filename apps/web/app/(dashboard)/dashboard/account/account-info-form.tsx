"use client";

import { useCallback, useEffect, useRef } from "react";

import { useRouter } from "next/navigation";

import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { z } from "zod";

import { toastManager } from "@louez/ui";

import { UserAvatar } from "@/components/dashboard/shared/user-avatar";

import { useAppForm } from "@/hooks/form/form";
import { useImageUpload } from "@/hooks/use-image-upload";

import { updateAccountInfo } from "./actions";

interface AccountInfoFormValues {
  name: string;
  // Local object URL for a new photo, null when removed, initialImage when untouched.
  image: string | null;
}

interface AccountInfoFormProps {
  initialName: string;
  initialImage: string | null;
  avatarSeed: string;
}

export const AccountInfoForm = ({
  initialName,
  initialImage,
  avatarSeed,
}: AccountInfoFormProps) => {
  const router = useRouter();
  const t = useTranslations("onboarding.profile");
  const tCommon = useTranslations("common");
  const tSettings = useTranslations("dashboard.settings");
  const tValidation = useTranslations("validation");
  const tErrors = useTranslations("errors");

  const { uploadImage, deleteImage, isUploading } = useImageUpload("avatar");
  const selectedImageFile = useRef<File | null>(null);
  const localPreviewUrl = useRef<string | null>(null);

  const releaseLocalPreview = useCallback(() => {
    if (!localPreviewUrl.current) return;
    URL.revokeObjectURL(localPreviewUrl.current);
    localPreviewUrl.current = null;
  }, []);

  useEffect(() => releaseLocalPreview, [releaseLocalPreview]);

  const accountInfoSchema = z.object({
    name: z
      .string()
      .trim()
      .min(2, tValidation("minLength", { min: 2 }))
      .max(255, tValidation("maxLength", { max: 255 })),
    image: z.string().nullable(),
  });

  const mutation = useMutation({
    mutationFn: async (value: AccountInfoFormValues) => {
      let uploadedKey: string | null = null;

      try {
        let imageUrl: string | null | undefined =
          value.image === initialImage ? undefined : value.image;

        if (selectedImageFile.current) {
          const uploaded = await uploadImage(selectedImageFile.current);
          uploadedKey = uploaded.key;
          imageUrl = uploaded.url;
        }

        const result = await updateAccountInfo({ name: value.name, imageUrl });
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
      image: initialImage,
    } satisfies AccountInfoFormValues,
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    validators: { onSubmit: accountInfoSchema },
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync(value);
        toastManager.add({ title: tSettings("settingsSaved"), type: "success" });
        router.refresh();
      } catch (error) {
        const message =
          error instanceof Error && error.message.startsWith("errors.")
            ? tErrors(error.message.replace("errors.", ""))
            : tErrors("generic");
        toastManager.add({ title: message, type: "error" });
      }
    },
  });

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

  return (
    <form.AppForm>
      <form.Form className="space-y-4">
        <form.AppField name="image">
          {(field) => (
            <field.ImageUpload
              label={t("photo")}
              description={t("photoHelp")}
              uploadLabel={tCommon("upload")}
              removeLabel={tCommon("remove")}
              kind="avatar"
              isUploading={isUploading}
              messages={{
                invalidType: t("photoError"),
                tooLarge: t("photoSizeError"),
              }}
              onFileSelected={handleImageSelected}
              onRemove={handleImageRemove}
              fallback={<UserAvatar seed={avatarSeed} size={48} />}
            />
          )}
        </form.AppField>

        <form.AppField name="name">
          {(field) => <field.Input label={t("name")} placeholder={t("namePlaceholder")} />}
        </form.AppField>

        <form.SubscribeButton>{tSettings("saveChanges")}</form.SubscribeButton>
      </form.Form>
    </form.AppForm>
  );
};
