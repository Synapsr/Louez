"use client";

import { useTranslations } from "next-intl";

import { Button, Label, Spinner } from "@louez/ui";
import { ImageIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";
import { X } from "lucide-react";

import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/uploads/image-upload";

import { useImageFieldUpload } from "../use-image-field-upload";
import type { OnlineStoreImageKind, PendingImageUploads } from "../use-pending-image-uploads";

interface LogoUploadFieldProps {
  id: string;
  label: string;
  /** Extra detail behind the label's info icon: what the image is for, its ideal size. */
  helper?: string;
  value: string | null;
  /** The saved image: never deleted from storage before the form is saved. */
  savedValue: string | null;
  uploads: PendingImageUploads;
  onChange: (next: string | null) => void;
  /** Storage folder and size limit; `logo` by default, `hero` for photos. */
  kind?: OnlineStoreImageKind;
  /** `square` for a favicon, `wide` for a share image; a logo tile otherwise. */
  shape?: "logo" | "square" | "wide";
  /** `white` for the dark-mode logo, which is meant for white paper and emails. */
  surface?: "muted" | "white";
}

const SHAPE_CLASS_NAMES: Record<NonNullable<LogoUploadFieldProps["shape"]>, string> = {
  logo: "h-12 w-16",
  square: "size-12",
  wide: "h-12 w-22",
};

/** One image slot on one line: the image (or an empty tile), its name, the upload button. */
export const LogoUploadField = ({
  id,
  label,
  helper,
  value,
  savedValue,
  uploads,
  onChange,
  kind = "logo",
  shape = "logo",
  surface = "muted",
}: LogoUploadFieldProps) => {
  const t = useTranslations("dashboard.settings.appearanceSettings");
  const { isUploading, select, remove } = useImageFieldUpload({
    kind,
    uploads,
    value,
    savedValue,
    onChange,
  });

  return (
    <div className="flex items-center gap-3">
      <label
        htmlFor={id}
        className={cn(
          "relative flex shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border transition-colors",
          SHAPE_CLASS_NAMES[shape],
          value
            ? surface === "white"
              ? "bg-white"
              : "bg-muted/50"
            : "border-dashed hover:border-primary/50 hover:bg-muted/40",
        )}
      >
        {value ? (
          <img
            src={value}
            alt=""
            className={cn(
              "h-full w-full",
              shape === "wide" ? "object-cover" : "object-contain p-1.5",
            )}
          />
        ) : (
          <ImageIcon aria-hidden className="size-4 text-muted-foreground" />
        )}
        {isUploading ? (
          <span className="absolute inset-0 flex items-center justify-center bg-background/80">
            <Spinner className="size-4 text-primary" />
          </span>
        ) : null}
      </label>

      <div className="min-w-0 flex-1">
        <Label htmlFor={id} helper={helper} className="font-normal">
          {label}
        </Label>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {value && !isUploading ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("removeLogo")}
            onClick={remove}
          >
            <X aria-hidden />
          </Button>
        ) : null}
        <Button variant="outline" size="sm" disabled={isUploading} render={<label htmlFor={id} />}>
          {value ? t("changeLogo") : t("uploadLogo")}
        </Button>
      </div>

      <input
        id={id}
        type="file"
        accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
        className="sr-only"
        disabled={isUploading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void select(file);
        }}
      />
    </div>
  );
};
