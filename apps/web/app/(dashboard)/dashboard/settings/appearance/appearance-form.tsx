"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { revalidateLogic, useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowRightIcon, CalendarIcon, ClockIcon, ImageIcon, SparklesIcon } from "@louez/ui/icons";
import { Upload, X, Check, Sun, Moon, Plus } from "lucide-react";
import { Button, Spinner } from "@louez/ui";
import { Label } from "@louez/ui";
import { Slider } from "@louez/ui";
import { toastManager } from "@louez/ui";
import { cn } from "@louez/utils";
import { FloatingSaveBar } from "@/components/dashboard/floating-save-bar";
import { FormRadioCardGroup } from "@/components/form/form-radio-card-group";
import { useAppForm } from "@/hooks/form/form";
import { ImageUploadValidationError, useImageUpload } from "@/hooks/use-image-upload";
import { orpc } from "@/lib/orpc/react";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/uploads/image-upload";
import type { StoreTheme } from "@louez/types";

interface Store {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  darkLogoUrl: string | null;
  theme: StoreTheme | null;
}

interface AppearanceFormProps {
  store: Store;
}

const appearanceFormSchema = z.object({
  logoUrl: z.string().nullable(),
  darkLogoUrl: z.string().nullable(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  themeMode: z.enum(["light", "dark"]),
  heroImages: z.array(z.string()).max(5),
  catalogBrowseMode: z.enum(["products", "categories"]).default("products"),
  maxDiscountEnabled: z.boolean(),
  maxDiscountPercent: z.number().int().min(0).max(100),
});

type AppearanceFormValues = z.input<typeof appearanceFormSchema>;

/**
 * Calculate the contrast text color (black or white) based on background color luminance.
 * Uses the WCAG relative luminance formula with a threshold of 0.55 to favor
 * white text on medium-dark colors like pink or purple.
 */
function getContrastColor(hexColor: string): "black" | "white" {
  // Remove # if present
  const hex = hexColor.replace("#", "");

  // Parse RGB values
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  // Calculate relative luminance using WCAG formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return black for light backgrounds, white for dark backgrounds
  // Threshold of 0.55 favors white text on medium-dark backgrounds
  return luminance > 0.55 ? "black" : "white";
}

/**
 * Parse a hex color input, handling various formats:
 * - With or without #
 * - Pasted values like "#fffe55"
 * - Partial values during typing
 */
function parseHexInput(input: string): string | null {
  // Remove # and any non-hex characters
  const cleaned = input.replace(/^#/, "").replace(/[^0-9A-Fa-f]/g, "");

  // Only return if we have exactly 6 characters
  if (cleaned.length === 6) {
    return `#${cleaned.toLowerCase()}`;
  }

  return null;
}

function isDataUri(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith("data:");
}

export const AppearanceForm = ({ store }: AppearanceFormProps) => {
  const router = useRouter();
  const t = useTranslations("dashboard.settings.appearanceSettings");
  const tErrors = useTranslations("errors");

  const suggestedColors = [
    { name: t("colors.blue"), value: "#2563eb" },
    { name: t("colors.green"), value: "#16a34a" },
    { name: t("colors.purple"), value: "#9333ea" },
    { name: t("colors.red"), value: "#dc2626" },
    { name: t("colors.orange"), value: "#ea580c" },
    { name: t("colors.pink"), value: "#db2777" },
    { name: t("colors.teal"), value: "#0d9488" },
    { name: t("colors.indigo"), value: "#4f46e5" },
  ];

  const defaultValues: AppearanceFormValues = {
    logoUrl: store.logoUrl,
    darkLogoUrl: store.darkLogoUrl,
    primaryColor: store.theme?.primaryColor || "#2563eb",
    themeMode: store.theme?.mode === "dark" ? "dark" : "light",
    heroImages: store.theme?.heroImages || [],
    catalogBrowseMode: store.theme?.catalogBrowseMode ?? "products",
    maxDiscountEnabled: store.theme?.maxDiscountPercent != null,
    maxDiscountPercent: store.theme?.maxDiscountPercent ?? 50,
  };

  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingDarkLogo, setIsUploadingDarkLogo] = useState(false);
  const [isUploadingHero, setIsUploadingHero] = useState(false);
  const [hexInputValue, setHexInputValue] = useState(
    defaultValues.primaryColor.replace("#", "").toUpperCase(),
  );
  const logoFiles = useImageUpload("logo");
  const heroFiles = useImageUpload("hero");
  const pendingUploadsRef = useRef(new Map<string, "logo" | "hero">());
  const deleteLogoRef = useRef(logoFiles.deleteImage);
  const deleteHeroRef = useRef(heroFiles.deleteImage);

  useEffect(() => {
    deleteLogoRef.current = logoFiles.deleteImage;
    deleteHeroRef.current = heroFiles.deleteImage;
  }, [heroFiles.deleteImage, logoFiles.deleteImage]);

  useEffect(
    () => () => {
      void Promise.allSettled(
        [...pendingUploadsRef.current].map(([url, kind]) =>
          kind === "logo" ? deleteLogoRef.current(url) : deleteHeroRef.current(url),
        ),
      );
    },
    [],
  );

  const deletePendingUpload = useCallback(
    (url: string) => {
      const kind = pendingUploadsRef.current.get(url);
      if (!kind) return;

      pendingUploadsRef.current.delete(url);
      const deletion = kind === "logo" ? logoFiles.deleteImage(url) : heroFiles.deleteImage(url);
      void deletion.catch(() => undefined);
    },
    [heroFiles, logoFiles],
  );

  const form = useAppForm({
    defaultValues,
    validators: { onSubmit: appearanceFormSchema },
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    onSubmit: async ({ value }) => {
      try {
        await updateAppearanceMutation.mutateAsync(value);
        toastManager.add({ title: t("updated"), type: "success" });
        form.options.defaultValues = value;
        form.reset();
        router.refresh();
      } catch (error) {
        toastManager.add({
          title:
            error instanceof Error && error.message === "errors.invalidData"
              ? tErrors("invalidData")
              : tErrors("generic"),
          type: "error",
        });
      }
    },
  });

  const updateAppearanceMutation = useMutation({
    ...orpc.dashboard.settings.updateAppearance.mutationOptions(),
    mutationFn: async (value: AppearanceFormValues) => {
      const baseline = form.options.defaultValues ?? defaultValues;
      const hasUnchangedLegacyLogo = isDataUri(value.logoUrl) && value.logoUrl === baseline.logoUrl;
      const hasUnchangedLegacyDarkLogo =
        value.themeMode === "dark" &&
        isDataUri(value.darkLogoUrl) &&
        value.darkLogoUrl === baseline.darkLogoUrl;
      const hasLegacyHeroImages = value.heroImages.some((image) => isDataUri(image));
      const hasUnchangedLegacyHeroImages =
        hasLegacyHeroImages &&
        JSON.stringify(value.heroImages) === JSON.stringify(baseline.heroImages);

      if (
        (isDataUri(value.logoUrl) && !hasUnchangedLegacyLogo) ||
        (value.themeMode === "dark" &&
          isDataUri(value.darkLogoUrl) &&
          !hasUnchangedLegacyDarkLogo) ||
        (hasLegacyHeroImages && !hasUnchangedLegacyHeroImages)
      ) {
        throw new Error("errors.invalidData");
      }

      const themePayload: {
        mode: "light" | "dark";
        primaryColor: string;
        catalogBrowseMode: "products" | "categories";
        maxDiscountPercent: number | null;
        heroImages?: string[];
      } = {
        mode: value.themeMode,
        primaryColor: value.primaryColor,
        catalogBrowseMode: value.catalogBrowseMode ?? "products",
        maxDiscountPercent: value.maxDiscountEnabled ? value.maxDiscountPercent : null,
      };

      if (!hasUnchangedLegacyHeroImages) {
        themePayload.heroImages = value.heroImages;
      }

      const payload: {
        logoUrl?: string | null;
        darkLogoUrl?: string | null;
        theme: typeof themePayload;
      } = {
        theme: themePayload,
      };

      if (!hasUnchangedLegacyLogo) {
        payload.logoUrl = value.logoUrl;
      }

      if (value.themeMode === "dark") {
        if (!hasUnchangedLegacyDarkLogo) {
          payload.darkLogoUrl = value.darkLogoUrl;
        }
      } else {
        payload.darkLogoUrl = null;
      }

      const result = await orpc.dashboard.settings.updateAppearance.call(payload);
      pendingUploadsRef.current.clear();

      const deletedImages: Promise<void>[] = [];
      if (baseline.logoUrl && baseline.logoUrl !== value.logoUrl) {
        deletedImages.push(logoFiles.deleteImage(baseline.logoUrl));
      }
      if (baseline.darkLogoUrl && baseline.darkLogoUrl !== value.darkLogoUrl) {
        deletedImages.push(logoFiles.deleteImage(baseline.darkLogoUrl));
      }
      for (const image of baseline.heroImages) {
        if (!value.heroImages.includes(image)) {
          deletedImages.push(heroFiles.deleteImage(image));
        }
      }
      void Promise.allSettled(deletedImages);

      return result;
    },
  });

  const isDirty = useStore(form.store, (state) => state.isDirty);
  const logoUrl = useStore(form.store, (state) => state.values.logoUrl);
  const darkLogoUrl = useStore(form.store, (state) => state.values.darkLogoUrl);
  const primaryColor = useStore(form.store, (state) => state.values.primaryColor);
  const themeMode = useStore(form.store, (state) => state.values.themeMode);
  const heroImages = useStore(form.store, (state) => state.values.heroImages);

  const handleReset = useCallback(() => {
    const baseline = form.options.defaultValues ?? defaultValues;

    if (logoUrl && logoUrl !== baseline.logoUrl) {
      deletePendingUpload(logoUrl);
    }
    if (darkLogoUrl && darkLogoUrl !== baseline.darkLogoUrl) {
      deletePendingUpload(darkLogoUrl);
    }
    for (const image of heroImages) {
      if (!baseline.heroImages.includes(image)) {
        deletePendingUpload(image);
      }
    }

    form.reset();
    setHexInputValue(baseline.primaryColor.replace("#", "").toUpperCase());
  }, [darkLogoUrl, defaultValues, deletePendingUpload, form, heroImages, logoUrl]);

  // Get contrast color for buttons
  const buttonTextColor = getContrastColor(primaryColor);

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const previousLogo = logoUrl;
    const previewUrl = URL.createObjectURL(file);
    form.setFieldValue("logoUrl", previewUrl);
    setIsUploadingLogo(true);

    try {
      const uploaded = await logoFiles.uploadImage(file);
      pendingUploadsRef.current.set(uploaded.url, "logo");
      form.setFieldValue("logoUrl", uploaded.url);
      const baseline = form.options.defaultValues ?? defaultValues;
      if (previousLogo && previousLogo !== baseline.logoUrl) {
        deletePendingUpload(previousLogo);
      }
    } catch (error) {
      if (error instanceof ImageUploadValidationError) {
        toastManager.add({
          title: error.issue === "tooLarge" ? t("fileTooLarge") : t("fileNotImage"),
          type: "error",
        });
      } else {
        toastManager.add({ title: tErrors("generic"), type: "error" });
      }
      form.setFieldValue("logoUrl", previousLogo);
    } finally {
      URL.revokeObjectURL(previewUrl);
      setIsUploadingLogo(false);
    }
  };

  const handleRemoveLogo = () => {
    const baseline = form.options.defaultValues ?? defaultValues;
    if (logoUrl && logoUrl !== baseline.logoUrl) {
      deletePendingUpload(logoUrl);
    }
    form.setFieldValue("logoUrl", null);
  };

  const handleDarkLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const previousLogo = darkLogoUrl;
    const previewUrl = URL.createObjectURL(file);
    form.setFieldValue("darkLogoUrl", previewUrl);
    setIsUploadingDarkLogo(true);

    try {
      const uploaded = await logoFiles.uploadImage(file);
      pendingUploadsRef.current.set(uploaded.url, "logo");
      form.setFieldValue("darkLogoUrl", uploaded.url);
      const baseline = form.options.defaultValues ?? defaultValues;
      if (previousLogo && previousLogo !== baseline.darkLogoUrl) {
        deletePendingUpload(previousLogo);
      }
    } catch (error) {
      if (error instanceof ImageUploadValidationError) {
        toastManager.add({
          title: error.issue === "tooLarge" ? t("fileTooLarge") : t("fileNotImage"),
          type: "error",
        });
      } else {
        toastManager.add({ title: tErrors("generic"), type: "error" });
      }
      form.setFieldValue("darkLogoUrl", previousLogo);
    } finally {
      URL.revokeObjectURL(previewUrl);
      setIsUploadingDarkLogo(false);
    }
  };

  const handleRemoveDarkLogo = () => {
    const baseline = form.options.defaultValues ?? defaultValues;
    if (darkLogoUrl && darkLogoUrl !== baseline.darkLogoUrl) {
      deletePendingUpload(darkLogoUrl);
    }
    form.setFieldValue("darkLogoUrl", null);
  };

  const handleHeroImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      const maxNew = Math.min(files.length, 5 - heroImages.length);
      if (maxNew <= 0) return;

      setIsUploadingHero(true);

      const uploadPromises: Promise<string | null>[] = [];

      for (let i = 0; i < maxNew; i++) {
        const file = files[i];
        const promise = heroFiles
          .uploadImage(file)
          .then((uploaded) => {
            pendingUploadsRef.current.set(uploaded.url, "hero");
            return uploaded.url;
          })
          .catch((error: unknown) => {
            if (error instanceof ImageUploadValidationError) {
              toastManager.add({
                title: error.issue === "tooLarge" ? t("fileTooLarge") : t("fileNotImage"),
                type: "error",
              });
            }
            return null;
          });

        uploadPromises.push(promise);
      }

      const results = await Promise.all(uploadPromises);
      const successfulUploads = results.filter((url): url is string => url !== null);

      if (successfulUploads.length > 0) {
        form.setFieldValue("heroImages", [...heroImages, ...successfulUploads]);
      }
      if (successfulUploads.length < uploadPromises.length) {
        toastManager.add({ title: tErrors("generic"), type: "error" });
      }

      setIsUploadingHero(false);
      e.target.value = "";
    },
    [form, heroFiles, heroImages, t, tErrors],
  );

  const removeHeroImage = (index: number) => {
    const baseline = form.options.defaultValues ?? defaultValues;
    const image = heroImages[index];
    if (image && !baseline.heroImages.includes(image)) {
      deletePendingUpload(image);
    }
    form.setFieldValue(
      "heroImages",
      heroImages.filter((_, imageIndex) => imageIndex !== index),
    );
  };

  const handleColorChange = (color: string) => {
    form.setFieldValue("primaryColor", color);
    setHexInputValue(color.replace("#", "").toUpperCase());
  };

  const handleHexInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase();
    setHexInputValue(value);

    const parsed = parseHexInput(value);
    if (parsed) {
      form.setFieldValue("primaryColor", parsed);
    }
  };

  const handleHexInputPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text");
    const parsed = parseHexInput(pasted);

    if (parsed) {
      form.setFieldValue("primaryColor", parsed);
      setHexInputValue(parsed.replace("#", "").toUpperCase());
    }
  };

  return (
    <form.AppForm>
      <form.Form>
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Settings Panel - Left side */}
          <div className="lg:w-[380px] shrink-0 space-y-8">
            {/* Logo Section */}
            <form.Field name="logoUrl">
              {(field) => (
                <section className="space-y-3">
                  <div>
                    <Label className="text-sm font-medium">{t("logo")}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {themeMode === "dark" ? t("logoDescriptionDark") : t("logoDescription")}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    {field.state.value ? (
                      <div className="relative">
                        <img
                          src={field.state.value}
                          alt="Logo"
                          className="h-14 w-auto max-w-[100px] rounded-lg border object-contain bg-muted/50 p-2"
                        />
                        {isUploadingLogo && (
                          <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg">
                            <Spinner className="h-5 w-5 text-primary" />
                          </div>
                        )}
                        {!isUploadingLogo && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            className="absolute -right-2 -top-2 h-5 w-5"
                            onClick={handleRemoveLogo}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-dashed bg-muted/20">
                        <Upload className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <div>
                      <Label
                        htmlFor="logo-upload"
                        className={cn(
                          "inline-flex items-center text-sm font-medium text-primary hover:underline",
                          isUploadingLogo ? "pointer-events-none opacity-50" : "cursor-pointer",
                        )}
                      >
                        {field.state.value ? t("changeLogo") : t("uploadLogo")}
                      </Label>
                      <input
                        id="logo-upload"
                        type="file"
                        accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
                        className="hidden"
                        onChange={handleLogoChange}
                        disabled={isUploadingLogo}
                      />
                      <p className="text-xs text-muted-foreground">PNG, JPG (max 2MB)</p>
                    </div>
                  </div>
                </section>
              )}
            </form.Field>

            {/* Dark Logo Section - Only visible when dark theme selected */}
            {themeMode === "dark" && (
              <form.Field name="darkLogoUrl">
                {(field) => (
                  <section className="space-y-3">
                    <div>
                      <Label className="text-sm font-medium">{t("darkLogo")}</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t("darkLogoDescription")}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      {field.state.value ? (
                        <div className="relative">
                          <img
                            src={field.state.value}
                            alt="Dark Logo"
                            className="h-14 w-auto max-w-[100px] rounded-lg border object-contain bg-white p-2"
                          />
                          {isUploadingDarkLogo && (
                            <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg">
                              <Spinner className="h-5 w-5 text-primary" />
                            </div>
                          )}
                          {!isUploadingDarkLogo && (
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon"
                              className="absolute -right-2 -top-2 h-5 w-5"
                              onClick={handleRemoveDarkLogo}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-dashed bg-white">
                          <Upload className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div>
                        <Label
                          htmlFor="dark-logo-upload"
                          className={cn(
                            "inline-flex items-center text-sm font-medium text-primary hover:underline",
                            isUploadingDarkLogo
                              ? "pointer-events-none opacity-50"
                              : "cursor-pointer",
                          )}
                        >
                          {field.state.value ? t("changeLogo") : t("uploadLogo")}
                        </Label>
                        <input
                          id="dark-logo-upload"
                          type="file"
                          accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
                          className="hidden"
                          onChange={handleDarkLogoChange}
                          disabled={isUploadingDarkLogo}
                        />
                        <p className="text-xs text-muted-foreground">PNG, JPG (max 2MB)</p>
                      </div>
                    </div>
                  </section>
                )}
              </form.Field>
            )}

            {/* Divider */}
            <div className="border-t" />

            {/* Primary Color Section */}
            <form.Field name="primaryColor">
              {(field) => (
                <section className="space-y-3">
                  <div>
                    <Label className="text-sm font-medium">{t("primaryColor")}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("primaryColorDescription")}
                    </p>
                  </div>
                  {/* Preset colors */}
                  <div className="flex flex-wrap gap-2">
                    {suggestedColors.map((color) => (
                      <button
                        key={color.value}
                        type="button"
                        onClick={() => handleColorChange(color.value)}
                        className={cn(
                          "h-8 w-8 rounded-full transition-all hover:scale-110",
                          field.state.value === color.value &&
                            "ring-2 ring-offset-2 ring-foreground scale-110",
                        )}
                        style={{ backgroundColor: color.value }}
                        title={color.name}
                      >
                        {field.state.value === color.value && (
                          <Check className="h-4 w-4 text-white m-auto" />
                        )}
                      </button>
                    ))}
                  </div>
                  {/* Custom color input */}
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <input
                        type="color"
                        value={field.state.value}
                        onChange={(e) => handleColorChange(e.target.value)}
                        className="h-9 w-9 cursor-pointer rounded-lg border p-0.5 overflow-hidden"
                      />
                    </div>
                    <div className="flex-1 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                        #
                      </span>
                      <input
                        type="text"
                        value={hexInputValue}
                        onChange={handleHexInputChange}
                        onPaste={handleHexInputPaste}
                        placeholder="2563EB"
                        maxLength={7}
                        className="w-full h-9 pl-7 pr-3 rounded-lg border bg-background text-sm font-mono uppercase"
                      />
                    </div>
                  </div>
                </section>
              )}
            </form.Field>

            {/* Divider */}
            <div className="border-t" />

            {/* Theme Mode Section */}
            <form.Field name="themeMode">
              {(field) => (
                <section className="space-y-3">
                  <div>
                    <Label className="text-sm font-medium">{t("theme")}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("themeDescription")}</p>
                  </div>
                  <FormRadioCardGroup
                    value={field.state.value}
                    onChange={(nextThemeMode) => {
                      field.handleChange(nextThemeMode);
                      if (nextThemeMode === "light") {
                        const baseline = form.options.defaultValues ?? defaultValues;
                        if (darkLogoUrl && darkLogoUrl !== baseline.darkLogoUrl) {
                          deletePendingUpload(darkLogoUrl);
                        }
                        form.setFieldValue("darkLogoUrl", null);
                      }
                    }}
                    options={[
                      { value: "light", label: t("themeLight"), icon: Sun },
                      { value: "dark", label: t("themeDark"), icon: Moon },
                    ]}
                    columns={2}
                  />
                </section>
              )}
            </form.Field>

            {/* Divider */}
            <div className="border-t" />

            {/* Hero Images Section */}
            <form.Field name="heroImages">
              {(field) => (
                <section className="space-y-3">
                  <div>
                    <Label className="text-sm font-medium">{t("heroImages")}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("heroImagesDescription")}
                    </p>
                  </div>
                  {field.state.value.length === 0 && !isUploadingHero ? (
                    <label className="flex h-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 transition-colors bg-muted/10">
                      <ImageIcon className="h-6 w-6 text-muted-foreground mb-1" />
                      <span className="text-sm font-medium">{t("addHeroImages")}</span>
                      <span className="text-xs text-muted-foreground">{t("heroImagesHint")}</span>
                      <input
                        type="file"
                        accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
                        multiple
                        className="sr-only"
                        onChange={handleHeroImageUpload}
                      />
                    </label>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {field.state.value.map((image, index) => (
                        <div key={index} className="group relative aspect-[4/3]">
                          <img
                            src={image}
                            alt={`Hero ${index + 1}`}
                            className="h-full w-full rounded-lg object-cover border"
                          />
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            className="absolute top-1 right-1 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => removeHeroImage(index)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                      {isUploadingHero && (
                        <div className="flex aspect-[4/3] items-center justify-center rounded-lg border-2 border-dashed border-primary/50 bg-primary/5">
                          <Spinner className="h-5 w-5 text-primary" />
                        </div>
                      )}
                      {field.state.value.length < 5 && !isUploadingHero && (
                        <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 transition-colors">
                          <Plus className="h-4 w-4 text-muted-foreground" />
                          <input
                            type="file"
                            accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
                            multiple
                            className="sr-only"
                            onChange={handleHeroImageUpload}
                          />
                        </label>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">{t("heroImagesOptional")}</p>
                </section>
              )}
            </form.Field>

            {/* Divider */}
            <div className="border-t" />

            {/* Catalog Browse Mode Section */}
            <form.Field name="catalogBrowseMode">
              {(field) => (
                <section className="space-y-3">
                  <div>
                    <Label className="text-sm font-medium">{t("catalogBrowseMode.title")}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("catalogBrowseMode.description")}
                    </p>
                  </div>
                  <FormRadioCardGroup<"products" | "categories">
                    value={field.state.value ?? "products"}
                    onChange={(nextCatalogBrowseMode) => field.handleChange(nextCatalogBrowseMode)}
                    options={[
                      {
                        value: "products",
                        label: t("catalogBrowseMode.products"),
                        description: t("catalogBrowseMode.productsDescription"),
                      },
                      {
                        value: "categories",
                        label: t("catalogBrowseMode.categories"),
                        description: t("catalogBrowseMode.categoriesDescription"),
                      },
                    ]}
                    columns={1}
                    errors={field.state.meta.errors}
                  />
                </section>
              )}
            </form.Field>

            {/* Divider */}
            <div className="border-t" />

            {/* Max Discount Percent Section */}
            <form.AppField name="maxDiscountEnabled">
              {(enabledField) => (
                <section className="space-y-3">
                  <enabledField.Switch
                    label={t("maxDiscount.title")}
                    description={t("maxDiscount.description")}
                  />
                  {enabledField.state.value && (
                    <form.Field name="maxDiscountPercent">
                      {(percentField) => (
                        <div className="space-y-3 rounded-lg border p-4">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">
                              {t("maxDiscount.upTo")}
                            </span>
                            <span className="text-sm font-medium tabular-nums">
                              {percentField.state.value}%
                            </span>
                          </div>
                          <Slider
                            value={[percentField.state.value]}
                            onValueChange={(value) =>
                              percentField.handleChange(Array.isArray(value) ? value[0] : value)
                            }
                            min={5}
                            max={100}
                            step={5}
                          />
                          <p className="text-xs text-muted-foreground">{t("maxDiscount.hint")}</p>
                        </div>
                      )}
                    </form.Field>
                  )}
                </section>
              )}
            </form.AppField>

            <FloatingSaveBar
              isDirty={isDirty}
              isLoading={
                updateAppearanceMutation.isPending ||
                isUploadingLogo ||
                isUploadingDarkLogo ||
                isUploadingHero
              }
              onReset={handleReset}
            />
          </div>

          {/* Live Preview - Right side, sticky */}
          <div className="flex-1 lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
              {/* Preview Header */}
              <div className="px-4 py-3 border-b bg-muted/30">
                <p className="text-sm font-medium text-muted-foreground">{t("preview")}</p>
              </div>

              {/* Storefront Preview */}
              <div
                className={cn(
                  "relative",
                  themeMode === "dark" ? "bg-zinc-950 text-white" : "bg-white text-zinc-950",
                )}
              >
                {/* Background gradient like storefront */}
                <div
                  className="absolute inset-0 opacity-5"
                  style={{
                    background: `radial-gradient(ellipse at top, ${primaryColor} 0%, transparent 70%)`,
                  }}
                />
                <div
                  className={cn(
                    "absolute inset-0",
                    themeMode === "dark"
                      ? "bg-gradient-to-b from-zinc-950 via-zinc-950/95 to-zinc-950"
                      : "bg-gradient-to-b from-white via-white/95 to-white",
                  )}
                />

                {/* Decorative blurs */}
                <div
                  className="absolute top-8 left-8 w-48 h-48 rounded-full blur-3xl opacity-10"
                  style={{ backgroundColor: primaryColor }}
                />
                <div
                  className="absolute bottom-12 right-8 w-64 h-64 rounded-full blur-3xl opacity-5"
                  style={{ backgroundColor: primaryColor }}
                />

                {/* Content */}
                <div className="relative p-5">
                  {/* Header simulation */}
                  <div className="flex items-center justify-between pb-3 border-b border-current/10 mb-6">
                    <div className="flex items-center gap-2">
                      {logoUrl ? (
                        <img src={logoUrl} alt="Logo" className="h-6 object-contain" />
                      ) : (
                        <span className="font-bold">{store.name}</span>
                      )}
                    </div>
                    <div className="flex gap-3 text-xs">
                      <span className={themeMode === "dark" ? "text-zinc-400" : "text-zinc-500"}>
                        {t("previewNav.catalog")}
                      </span>
                      <span className={themeMode === "dark" ? "text-zinc-400" : "text-zinc-500"}>
                        {t("previewNav.contact")}
                      </span>
                    </div>
                  </div>

                  {/* Hero section simulation */}
                  <div
                    className={cn(
                      "flex gap-6 mb-6",
                      heroImages.length > 0
                        ? "items-start"
                        : "items-center justify-center text-center",
                    )}
                  >
                    {/* Text content */}
                    <div className={cn("space-y-3", heroImages.length > 0 ? "flex-1" : "max-w-sm")}>
                      {logoUrl && (
                        <div
                          className={cn("mb-3", heroImages.length === 0 && "flex justify-center")}
                        >
                          <div className="relative inline-block">
                            <div
                              className="absolute inset-0 blur-xl rounded-full scale-150 opacity-20"
                              style={{ backgroundColor: primaryColor }}
                            />
                            <img
                              src={logoUrl}
                              alt="Logo"
                              className="relative h-10 object-contain"
                            />
                          </div>
                        </div>
                      )}

                      <h2 className="text-xl font-bold">{store.name}</h2>
                      <p
                        className={cn(
                          "text-xs",
                          themeMode === "dark" ? "text-zinc-400" : "text-zinc-600",
                        )}
                      >
                        {t("previewCatalogText")}
                      </p>

                      {/* Stats */}
                      <div
                        className={cn(
                          "flex gap-3 text-xs",
                          themeMode === "dark" ? "text-zinc-500" : "text-zinc-500",
                          heroImages.length === 0 && "justify-center",
                        )}
                      >
                        <span className="flex items-center gap-1">
                          <SparklesIcon className="h-3 w-3" style={{ color: primaryColor }} />
                          {t("previewStats", { count: 10 })}
                        </span>
                      </div>

                      {/* CTA Button - only when hero images */}
                      {heroImages.length > 0 && (
                        <div>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-md text-xs font-medium h-8 px-3"
                            style={{
                              backgroundColor: primaryColor,
                              color: buttonTextColor,
                            }}
                          >
                            {t("previewCatalogButton")}
                            <ArrowRightIcon className="h-3 w-3 ml-1" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Hero image preview - ENLARGED */}
                    {heroImages.length > 0 && (
                      <div className="w-44 shrink-0">
                        <div className="aspect-[4/3] rounded-xl overflow-hidden shadow-xl">
                          <img
                            src={heroImages[0]}
                            alt="Hero preview"
                            className="h-full w-full object-cover"
                          />
                        </div>
                        {heroImages.length > 1 && (
                          <div className="flex justify-center gap-1 mt-2">
                            {heroImages.slice(0, 5).map((_, i) => (
                              <div
                                key={i}
                                className={cn(
                                  "h-1 rounded-full transition-all",
                                  i === 0 ? "w-3" : "w-1",
                                  themeMode === "dark" ? "bg-white/50" : "bg-zinc-400/50",
                                  i === 0 && (themeMode === "dark" ? "bg-white" : "bg-zinc-600"),
                                )}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Date Picker Simulation - REDUCED WIDTH */}
                  <div className="max-w-sm mx-auto">
                    <div
                      className={cn(
                        "rounded-xl p-4",
                        themeMode === "dark"
                          ? "bg-zinc-900 border border-zinc-800"
                          : "bg-white border shadow-lg",
                      )}
                      style={{
                        borderColor: themeMode === "dark" ? undefined : `${primaryColor}20`,
                        boxShadow:
                          themeMode === "dark" ? undefined : `0 4px 20px ${primaryColor}10`,
                      }}
                    >
                      {/* Date picker header */}
                      <div className="text-center mb-3">
                        <div className="flex items-center justify-center gap-1.5 font-medium text-sm">
                          <CalendarIcon className="h-4 w-4" style={{ color: primaryColor }} />
                          {t("previewDatePicker.title")}
                        </div>
                        <p
                          className={cn(
                            "text-xs mt-0.5",
                            themeMode === "dark" ? "text-zinc-500" : "text-zinc-500",
                          )}
                        >
                          {t("previewDatePicker.subtitle")}
                        </p>
                      </div>

                      {/* Progress dots */}
                      <div className="flex justify-center gap-1 mb-3">
                        <div
                          className="h-1 w-6 rounded-full"
                          style={{ backgroundColor: primaryColor }}
                        />
                        <div
                          className="h-1 w-4 rounded-full"
                          style={{ backgroundColor: `${primaryColor}50` }}
                        />
                        <div
                          className={cn(
                            "h-1 w-4 rounded-full",
                            themeMode === "dark" ? "bg-zinc-700" : "bg-zinc-200",
                          )}
                        />
                        <div
                          className={cn(
                            "h-1 w-4 rounded-full",
                            themeMode === "dark" ? "bg-zinc-700" : "bg-zinc-200",
                          )}
                        />
                      </div>

                      {/* Date/Time inputs simulation */}
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {/* Start */}
                        <div>
                          <p
                            className={cn(
                              "text-xs mb-1",
                              themeMode === "dark" ? "text-zinc-500" : "text-zinc-500",
                            )}
                          >
                            {t("previewDatePicker.startLabel")}
                          </p>
                          <div
                            className={cn(
                              "flex rounded-md border-2 overflow-hidden text-xs",
                              themeMode === "dark"
                                ? "bg-zinc-800 border-zinc-700"
                                : "bg-zinc-50 border-zinc-200",
                            )}
                            style={{ borderColor: primaryColor }}
                          >
                            <div className="flex items-center gap-1 px-2 py-1.5 flex-1">
                              <CalendarIcon className="h-3 w-3 opacity-50" />
                              <span className="font-medium">
                                {t("previewDatePicker.startDateExample")}
                              </span>
                            </div>
                            <div
                              className={cn(
                                "w-px",
                                themeMode === "dark" ? "bg-zinc-700" : "bg-zinc-200",
                              )}
                            />
                            <div className="flex items-center gap-1 px-2 py-1.5">
                              <ClockIcon className="h-3 w-3 opacity-50" />
                              <span className="font-medium">09:00</span>
                            </div>
                          </div>
                        </div>

                        {/* End */}
                        <div>
                          <p
                            className={cn(
                              "text-xs mb-1",
                              themeMode === "dark" ? "text-zinc-500" : "text-zinc-500",
                            )}
                          >
                            {t("previewDatePicker.endLabel")}
                          </p>
                          <div
                            className={cn(
                              "flex rounded-md border-2 overflow-hidden text-xs",
                              themeMode === "dark"
                                ? "bg-zinc-800 border-zinc-700"
                                : "bg-zinc-50 border-zinc-200",
                            )}
                          >
                            <div className="flex items-center gap-1 px-2 py-1.5 flex-1">
                              <CalendarIcon className="h-3 w-3 opacity-50" />
                              <span
                                className={themeMode === "dark" ? "text-zinc-500" : "text-zinc-400"}
                              >
                                {t("previewDatePicker.endDatePlaceholder")}
                              </span>
                            </div>
                            <div
                              className={cn(
                                "w-px",
                                themeMode === "dark" ? "bg-zinc-700" : "bg-zinc-200",
                              )}
                            />
                            <div className="flex items-center gap-1 px-2 py-1.5">
                              <ClockIcon className="h-3 w-3 opacity-50" />
                              <span className="font-medium">18:00</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Submit button with contrast */}
                      <button
                        type="button"
                        className="w-full flex items-center justify-center gap-1.5 rounded-md text-xs font-medium h-9"
                        style={{
                          backgroundColor: primaryColor,
                          color: buttonTextColor,
                        }}
                      >
                        {t("previewDatePicker.submitButton")}
                        <ArrowRightIcon className="h-3 w-3" />
                      </button>

                      {/* Quick select */}
                      <div
                        className={cn(
                          "mt-3 pt-3 border-t",
                          themeMode === "dark" ? "border-zinc-800" : "border-zinc-100",
                        )}
                      >
                        <p
                          className={cn(
                            "text-xs text-center mb-2",
                            themeMode === "dark" ? "text-zinc-600" : "text-zinc-400",
                          )}
                        >
                          {t("previewDatePicker.quickSelectTitle")}
                        </p>
                        <div className="flex justify-center gap-1.5">
                          {[
                            t("previewDatePicker.quickSelectWeekend"),
                            t("previewDatePicker.quickSelectNextWeek"),
                            t("previewDatePicker.quickSelectTwoWeeks"),
                          ].map((label) => (
                            <span
                              key={label}
                              className={cn(
                                "text-xs px-2 py-1 rounded-md",
                                themeMode === "dark"
                                  ? "bg-zinc-800 text-zinc-400"
                                  : "bg-zinc-100 text-zinc-600",
                              )}
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Product cards simulation - smaller */}
                  <div className="mt-5 pt-4 border-t border-current/10">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-medium text-sm">{t("previewProducts.title")}</h3>
                      <span className="text-xs font-medium" style={{ color: primaryColor }}>
                        {t("previewProducts.viewAll")}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className={cn(
                            "rounded-lg overflow-hidden border",
                            themeMode === "dark"
                              ? "bg-zinc-900 border-zinc-800"
                              : "bg-zinc-50 border-zinc-200",
                          )}
                        >
                          <div
                            className={cn(
                              "aspect-square",
                              themeMode === "dark" ? "bg-zinc-800" : "bg-zinc-200",
                            )}
                          />
                          <div className="p-1.5">
                            <div
                              className={cn(
                                "h-1.5 rounded w-2/3 mb-1",
                                themeMode === "dark" ? "bg-zinc-700" : "bg-zinc-300",
                              )}
                            />
                            <div
                              className="h-1.5 rounded w-1/3"
                              style={{ backgroundColor: primaryColor, opacity: 0.7 }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form.Form>
    </form.AppForm>
  );
};
