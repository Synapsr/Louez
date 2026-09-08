"use client";

import { useTranslations } from "next-intl";

import { Button, Label, Spinner } from "@louez/ui";
import { ImageIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";
import { X } from "lucide-react";

import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/uploads/image-upload";

import { useImageFieldUpload } from "./use-image-field-upload";
import type { PendingImageUploads } from "./use-pending-image-uploads";

interface LogoUploadFieldProps {
  id: string;
  label: string;
  description: string;
  value: string | null;
  /** The saved logo: never deleted from storage before the form is saved. */
  savedValue: string | null;
  uploads: PendingImageUploads;
  onChange: (next: string | null) => void;
  /** `white` for the dark-mode logo, which is meant for white paper and emails. */
  surface?: "muted" | "white";
}

/** A logo slot: the current logo (or an empty tile), and the upload button. */
export const LogoUploadField = ({
  id,
  label,
  description,
  value,
  savedValue,
  uploads,
  onChange,
  surface = "muted",
}: LogoUploadFieldProps) => {
  const t = useTranslations("dashboard.settings.appearanceSettings");
  const { isUploading, select, remove } = useImageFieldUpload({
    kind: "logo",
    uploads,
    value,
    savedValue,
    onChange,
  });

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border",
            value ? (surface === "white" ? "bg-white" : "bg-muted/50") : "border-dashed",
          )}
        >
          {value ? (
            <img src={value} alt="" className="h-full w-full object-contain p-2" />
          ) : (
            <ImageIcon aria-hidden className="size-5 text-muted-foreground" />
          )}
          {isUploading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80">
              <Spinner className="size-5 text-primary" />
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-start gap-1">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={isUploading}
              render={<label htmlFor={id} />}
            >
              {value ? t("changeLogo") : t("uploadLogo")}
            </Button>
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
          </div>
          <p className="text-muted-foreground text-xs">{t("logoFormats")}</p>
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
      </div>
    </div>
  );
};
