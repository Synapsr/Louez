"use client";

import { useTranslations } from "next-intl";

import { SelectItem } from "@louez/ui";
import { BUSINESS_TYPES, type BusinessType } from "@louez/validations";

import { UserAvatar } from "@/components/dashboard/shared/user-avatar";

import { OnboardingStepHeader } from "../_components/step-header";
import { useProfileStep } from "./use-profile-step";

const BUSINESS_TYPE_LABEL_KEY: Record<BusinessType, string> = {
  independent: "independent",
  established_store: "establishedStore",
  association: "association",
};

interface ProfileClientPageProps {
  initialName: string;
  initialImage: string | null;
  initialBusinessType: BusinessType | null;
  avatarSeed: string;
}

export function ProfileClientPage({
  initialName,
  initialImage,
  initialBusinessType,
  avatarSeed,
}: ProfileClientPageProps) {
  const t = useTranslations("onboarding.profile");
  const tCommon = useTranslations("common");

  const { form, handleImageSelected, handleImageRemove, isUploading } = useProfileStep({
    initialName,
    initialImage,
    initialBusinessType,
  });

  const businessTypeItems = BUSINESS_TYPES.map((type) => ({
    value: type,
    label: t(`businessTypes.${BUSINESS_TYPE_LABEL_KEY[type]}`),
  }));

  return (
    <>
      <OnboardingStepHeader title={t("title")} description={t("description")} />
      <form.AppForm>
        <form.Form className="space-y-3">
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

          <form.AppField name="businessType">
            {(field) => (
              <field.Select
                label={`${t("businessType")} (${tCommon("optional")})`}
                placeholder={t("businessTypePlaceholder")}
                items={businessTypeItems}
              >
                {businessTypeItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </field.Select>
            )}
          </form.AppField>

          <form.SubscribeButton className="mt-2 w-full">{tCommon("next")}</form.SubscribeButton>
        </form.Form>
      </form.AppForm>
    </>
  );
}
