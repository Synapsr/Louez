"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import {
  Upload,
  X,
  Check,
  Sun,
  Moon,
  Plus,
  ImageIcon,
  Sparkles,
  ArrowRight,
  CalendarIcon,
  Clock,
  Loader2,
} from "lucide-react";
import { Button } from "@louez/ui";
import { Label } from "@louez/ui";
import { Switch } from "@louez/ui";
import { Slider } from "@louez/ui";
import { toastManager } from "@louez/ui";
import { cn } from "@louez/utils";
import { FloatingSaveBar } from "@/components/dashboard/floating-save-bar";
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

export function AppearanceForm({ store }: AppearanceFormProps) {
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

  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingDarkLogo, setIsUploadingDarkLogo] = useState(false);
  const [isUploadingHero, setIsUploadingHero] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(store.logoUrl);
  const [darkLogoPreview, setDarkLogoPreview] = useState<string | null>(store.darkLogoUrl);
  const [primaryColor, setPrimaryColor] = useState(store.theme?.primaryColor || "#2563eb");
  const [themeMode, setThemeMode] = useState<"light" | "dark">(
    store.theme?.mode === "dark" ? "dark" : "light",
  );
  const [heroImages, setHeroImages] = useState<string[]>(store.theme?.heroImages || []);
  const [maxDiscountEnabled, setMaxDiscountEnabled] = useState(
    store.theme?.maxDiscountPercent != null,
  );
  const [maxDiscountPercent, setMaxDiscountPercent] = useState(
    store.theme?.maxDiscountPercent ?? 50,
  );
  const [hexInputValue, setHexInputValue] = useState(primaryColor.replace("#", "").toUpperCase());
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

  const updateAppearanceMutation = useMutation(
    orpc.dashboard.settings.updateAppearance.mutationOptions(),
  );

  // Track initial values for dirty state detection
  const initialValues = useMemo(
    () => ({
      logoUrl: store.logoUrl,
      darkLogoUrl: store.darkLogoUrl,
      primaryColor: store.theme?.primaryColor || "#2563eb",
      themeMode: store.theme?.mode === "dark" ? "dark" : "light",
      heroImages: store.theme?.heroImages || [],
      maxDiscountEnabled: store.theme?.maxDiscountPercent != null,
      maxDiscountPercent: store.theme?.maxDiscountPercent ?? 50,
    }),
    [
      store.logoUrl,
      store.darkLogoUrl,
      store.theme?.primaryColor,
      store.theme?.mode,
      store.theme?.heroImages,
      store.theme?.maxDiscountPercent,
    ],
  );

  const isDirty = useMemo(() => {
    return (
      logoPreview !== initialValues.logoUrl ||
      darkLogoPreview !== initialValues.darkLogoUrl ||
      primaryColor !== initialValues.primaryColor ||
      themeMode !== initialValues.themeMode ||
      JSON.stringify(heroImages) !== JSON.stringify(initialValues.heroImages) ||
      maxDiscountEnabled !== initialValues.maxDiscountEnabled ||
      (maxDiscountEnabled && maxDiscountPercent !== initialValues.maxDiscountPercent)
    );
  }, [
    logoPreview,
    darkLogoPreview,
    primaryColor,
    themeMode,
    heroImages,
    maxDiscountEnabled,
    maxDiscountPercent,
    initialValues,
  ]);

  const handleReset = useCallback(() => {
    if (logoPreview && logoPreview !== initialValues.logoUrl) {
      deletePendingUpload(logoPreview);
    }
    if (darkLogoPreview && darkLogoPreview !== initialValues.darkLogoUrl) {
      deletePendingUpload(darkLogoPreview);
    }
    for (const image of heroImages) {
      if (!initialValues.heroImages.includes(image)) {
        deletePendingUpload(image);
      }
    }

    setLogoPreview(initialValues.logoUrl);
    setDarkLogoPreview(initialValues.darkLogoUrl);
    setPrimaryColor(initialValues.primaryColor);
    setThemeMode(initialValues.themeMode as "light" | "dark");
    setHeroImages(initialValues.heroImages);
    setHexInputValue(initialValues.primaryColor.replace("#", "").toUpperCase());
    setMaxDiscountEnabled(initialValues.maxDiscountEnabled);
    setMaxDiscountPercent(initialValues.maxDiscountPercent);
  }, [darkLogoPreview, deletePendingUpload, heroImages, initialValues, logoPreview]);

  // Get contrast color for buttons
  const buttonTextColor = getContrastColor(primaryColor);

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const previousLogo = logoPreview;
    const previewUrl = URL.createObjectURL(file);
    setLogoPreview(previewUrl);
    setIsUploadingLogo(true);

    try {
      const uploaded = await logoFiles.uploadImage(file);
      pendingUploadsRef.current.set(uploaded.url, "logo");
      setLogoPreview(uploaded.url);
      if (previousLogo && previousLogo !== initialValues.logoUrl) {
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
      setLogoPreview(previousLogo);
    } finally {
      URL.revokeObjectURL(previewUrl);
      setIsUploadingLogo(false);
    }
  };

  const handleRemoveLogo = () => {
    if (logoPreview && logoPreview !== initialValues.logoUrl) {
      deletePendingUpload(logoPreview);
    }
    setLogoPreview(null);
  };

  const handleDarkLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const previousLogo = darkLogoPreview;
    const previewUrl = URL.createObjectURL(file);
    setDarkLogoPreview(previewUrl);
    setIsUploadingDarkLogo(true);

    try {
      const uploaded = await logoFiles.uploadImage(file);
      pendingUploadsRef.current.set(uploaded.url, "logo");
      setDarkLogoPreview(uploaded.url);
      if (previousLogo && previousLogo !== initialValues.darkLogoUrl) {
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
      setDarkLogoPreview(previousLogo);
    } finally {
      URL.revokeObjectURL(previewUrl);
      setIsUploadingDarkLogo(false);
    }
  };

  const handleRemoveDarkLogo = () => {
    if (darkLogoPreview && darkLogoPreview !== initialValues.darkLogoUrl) {
      deletePendingUpload(darkLogoPreview);
    }
    setDarkLogoPreview(null);
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
        setHeroImages((prev) => [...prev, ...successfulUploads]);
      }
      if (successfulUploads.length < uploadPromises.length) {
        toastManager.add({ title: tErrors("generic"), type: "error" });
      }

      setIsUploadingHero(false);
      e.target.value = "";
    },
    [heroFiles, heroImages.length, t, tErrors],
  );

  const removeHeroImage = (index: number) => {
    const image = heroImages[index];
    if (image && !initialValues.heroImages.includes(image)) {
      deletePendingUpload(image);
    }
    setHeroImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleColorChange = (color: string) => {
    setPrimaryColor(color);
    setHexInputValue(color.replace("#", "").toUpperCase());
  };

  const handleHexInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase();
    setHexInputValue(value);

    const parsed = parseHexInput(value);
    if (parsed) {
      setPrimaryColor(parsed);
    }
  };

  const handleHexInputPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text");
    const parsed = parseHexInput(pasted);

    if (parsed) {
      setPrimaryColor(parsed);
      setHexInputValue(parsed.replace("#", "").toUpperCase());
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const hasUnchangedLegacyLogo =
        isDataUri(logoPreview) && logoPreview === initialValues.logoUrl;

      const hasUnchangedLegacyDarkLogo =
        themeMode === "dark" &&
        isDataUri(darkLogoPreview) &&
        darkLogoPreview === initialValues.darkLogoUrl;

      const hasLegacyHeroImages = heroImages.some((image) => isDataUri(image));
      const hasUnchangedLegacyHeroImages =
        hasLegacyHeroImages &&
        JSON.stringify(heroImages) === JSON.stringify(initialValues.heroImages);

      if (
        (isDataUri(logoPreview) && !hasUnchangedLegacyLogo) ||
        (themeMode === "dark" && isDataUri(darkLogoPreview) && !hasUnchangedLegacyDarkLogo) ||
        (hasLegacyHeroImages && !hasUnchangedLegacyHeroImages)
      ) {
        toastManager.add({ title: tErrors("invalidData"), type: "error" });
        return;
      }

      const themePayload: {
        mode: "light" | "dark";
        primaryColor: string;
        maxDiscountPercent: number | null;
        heroImages?: string[];
      } = {
        mode: themeMode,
        primaryColor,
        maxDiscountPercent: maxDiscountEnabled ? maxDiscountPercent : null,
      };

      if (!hasUnchangedLegacyHeroImages) {
        themePayload.heroImages = heroImages;
      }

      const payload: {
        logoUrl?: string | null;
        darkLogoUrl?: string | null;
        theme: typeof themePayload;
      } = {
        theme: themePayload,
      };

      if (!hasUnchangedLegacyLogo) {
        payload.logoUrl = logoPreview;
      }

      if (themeMode === "dark") {
        if (!hasUnchangedLegacyDarkLogo) {
          payload.darkLogoUrl = darkLogoPreview;
        }
      } else {
        payload.darkLogoUrl = null;
      }

      await updateAppearanceMutation.mutateAsync(payload);
      pendingUploadsRef.current.clear();

      const deletedImages: Promise<void>[] = [];
      if (initialValues.logoUrl && initialValues.logoUrl !== logoPreview) {
        deletedImages.push(logoFiles.deleteImage(initialValues.logoUrl));
      }
      if (initialValues.darkLogoUrl && initialValues.darkLogoUrl !== darkLogoPreview) {
        deletedImages.push(logoFiles.deleteImage(initialValues.darkLogoUrl));
      }
      for (const image of initialValues.heroImages) {
        if (!heroImages.includes(image)) {
          deletedImages.push(heroFiles.deleteImage(image));
        }
      }
      void Promise.allSettled(deletedImages);

      toastManager.add({ title: t("updated"), type: "success" });
      router.refresh();
    } catch {
      toastManager.add({ title: tErrors("generic"), type: "error" });
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Settings Panel - Left side */}
        <div className="lg:w-[380px] shrink-0 space-y-8">
          {/* Logo Section */}
          <section className="space-y-3">
            <div>
              <Label className="text-sm font-medium">{t("logo")}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {themeMode === "dark" ? t("logoDescriptionDark") : t("logoDescription")}
              </p>
            </div>
            <div className="flex items-center gap-4">
              {logoPreview ? (
                <div className="relative">
                  <img
                    src={logoPreview}
                    alt="Logo"
                    className="h-14 w-auto max-w-[100px] rounded-lg border object-contain bg-muted/50 p-2"
                  />
                  {isUploadingLogo && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
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
                  {logoPreview ? t("changeLogo") : t("uploadLogo")}
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

          {/* Dark Logo Section - Only visible when dark theme selected */}
          {themeMode === "dark" && (
            <section className="space-y-3">
              <div>
                <Label className="text-sm font-medium">{t("darkLogo")}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">{t("darkLogoDescription")}</p>
              </div>
              <div className="flex items-center gap-4">
                {darkLogoPreview ? (
                  <div className="relative">
                    <img
                      src={darkLogoPreview}
                      alt="Dark Logo"
                      className="h-14 w-auto max-w-[100px] rounded-lg border object-contain bg-white p-2"
                    />
                    {isUploadingDarkLogo && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
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
                      isUploadingDarkLogo ? "pointer-events-none opacity-50" : "cursor-pointer",
                    )}
                  >
                    {darkLogoPreview ? t("changeLogo") : t("uploadLogo")}
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

          {/* Divider */}
          <div className="border-t" />

          {/* Primary Color Section */}
          <section className="space-y-3">
            <div>
              <Label className="text-sm font-medium">{t("primaryColor")}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">{t("primaryColorDescription")}</p>
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
                    primaryColor === color.value &&
                      "ring-2 ring-offset-2 ring-foreground scale-110",
                  )}
                  style={{ backgroundColor: color.value }}
                  title={color.name}
                >
                  {primaryColor === color.value && <Check className="h-4 w-4 text-white m-auto" />}
                </button>
              ))}
            </div>
            {/* Custom color input */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="color"
                  value={primaryColor}
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

          {/* Divider */}
          <div className="border-t" />

          {/* Theme Mode Section */}
          <section className="space-y-3">
            <div>
              <Label className="text-sm font-medium">{t("theme")}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">{t("themeDescription")}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setThemeMode("light");
                  if (darkLogoPreview && darkLogoPreview !== initialValues.darkLogoUrl) {
                    deletePendingUpload(darkLogoPreview);
                  }
                  setDarkLogoPreview(null);
                }}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 rounded-lg border-2 py-2.5 px-3 transition-all",
                  themeMode === "light"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/50",
                )}
              >
                <Sun className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-medium">{t("themeLight")}</span>
                {themeMode === "light" && <Check className="h-4 w-4 text-primary ml-1" />}
              </button>
              <button
                type="button"
                onClick={() => setThemeMode("dark")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 rounded-lg border-2 py-2.5 px-3 transition-all",
                  themeMode === "dark"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/50",
                )}
              >
                <Moon className="h-4 w-4 text-slate-500" />
                <span className="text-sm font-medium">{t("themeDark")}</span>
                {themeMode === "dark" && <Check className="h-4 w-4 text-primary ml-1" />}
              </button>
            </div>
          </section>

          {/* Divider */}
          <div className="border-t" />

          {/* Hero Images Section */}
          <section className="space-y-3">
            <div>
              <Label className="text-sm font-medium">{t("heroImages")}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">{t("heroImagesDescription")}</p>
            </div>
            {heroImages.length === 0 && !isUploadingHero ? (
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
                {heroImages.map((image, index) => (
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
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                )}
                {heroImages.length < 5 && !isUploadingHero && (
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

          {/* Max Discount Percent Section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{t("maxDiscount.title")}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("maxDiscount.description")}
                </p>
              </div>
              <Switch checked={maxDiscountEnabled} onCheckedChange={setMaxDiscountEnabled} />
            </div>
            {maxDiscountEnabled && (
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t("maxDiscount.upTo")}</span>
                  <span className="text-sm font-medium tabular-nums">{maxDiscountPercent}%</span>
                </div>
                <Slider
                  value={[maxDiscountPercent]}
                  onValueChange={(value) =>
                    setMaxDiscountPercent(Array.isArray(value) ? value[0] : value)
                  }
                  min={5}
                  max={100}
                  step={5}
                />
                <p className="text-xs text-muted-foreground">{t("maxDiscount.hint")}</p>
              </div>
            )}
          </section>

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
                    {logoPreview ? (
                      <img src={logoPreview} alt="Logo" className="h-6 object-contain" />
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
                    {logoPreview && (
                      <div className={cn("mb-3", heroImages.length === 0 && "flex justify-center")}>
                        <div className="relative inline-block">
                          <div
                            className="absolute inset-0 blur-xl rounded-full scale-150 opacity-20"
                            style={{ backgroundColor: primaryColor }}
                          />
                          <img
                            src={logoPreview}
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
                        <Sparkles className="h-3 w-3" style={{ color: primaryColor }} />
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
                          <ArrowRight className="h-3 w-3 ml-1" />
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
                      boxShadow: themeMode === "dark" ? undefined : `0 4px 20px ${primaryColor}10`,
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
                            <Clock className="h-3 w-3 opacity-50" />
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
                            <Clock className="h-3 w-3 opacity-50" />
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
                      <ArrowRight className="h-3 w-3" />
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
    </form>
  );
}
