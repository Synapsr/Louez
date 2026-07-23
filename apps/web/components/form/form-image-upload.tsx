"use client";

import { ImageIcon, Loader2, Upload } from "lucide-react";

import { Button, Label, buttonVariants, toastManager } from "@louez/ui";
import { cn } from "@louez/utils";

import {
  IMAGE_UPLOAD_MIME_TYPES,
  type ImageUploadIssue,
  type ImageUploadKind,
  getImageUploadIssue,
} from "@/lib/uploads/image-upload";

import { getFieldError, useFieldContext } from "@/hooks/form/form-context";

interface FormImageUploadProps {
  label?: string;
  description?: string;
  uploadLabel: string;
  removeLabel: string;
  kind: ImageUploadKind;
  /** Toast messages shown when the selected file is rejected or unreadable. */
  messages: Record<ImageUploadIssue, string>;
  /** Rendered in the preview slot when the field is empty. */
  fallback?: React.ReactNode;
  /** Local-only preview that must not be written to the validated form value. */
  previewUrl?: string | null;
  shape?: "circle" | "square";
  /** Show a spinner in the preview slot (e.g. while an async upload runs). */
  isUploading?: boolean;
  onFileSelected: (file: File) => void | Promise<void>;
  /** Override removal (default: set the field to null). */
  onRemove?: () => void;
}

export function FormImageUpload({
  label,
  description,
  uploadLabel,
  removeLabel,
  kind,
  messages,
  fallback,
  previewUrl,
  shape = "square",
  isUploading = false,
  onFileSelected,
  onRemove,
}: FormImageUploadProps) {
  const field = useFieldContext<string | null>();
  const value = field.state.value || null;
  const displayValue = previewUrl || value;
  const errors = field.state.meta.errors;
  const error = errors[0];

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    const issue = getImageUploadIssue(file, kind);
    if (issue) {
      toastManager.add({ title: messages[issue], type: "error" });
      return;
    }

    await onFileSelected(file);
  };

  const handleRemove = onRemove ?? (() => field.handleChange(null));

  return (
    <div className="space-y-2">
      {label && <Label data-error={errors.length > 0}>{label}</Label>}
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex shrink-0 items-center justify-center overflow-hidden border",
            shape === "circle" ? "size-12 rounded-full" : "bg-muted/50 size-10 rounded-lg",
          )}
        >
          {isUploading ? (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          ) : displayValue ? (
            <img
              src={displayValue}
              alt=""
              className={cn("size-full", shape === "circle" ? "object-cover" : "object-cover")}
            />
          ) : (
            (fallback ?? <ImageIcon className="text-muted-foreground size-4" />)
          )}
        </div>
        <label
          aria-disabled={isUploading}
          className={cn(
            buttonVariants({ size: "lg", variant: "outline" }),
            isUploading && "pointer-events-none opacity-50",
          )}
        >
          <Upload className="size-3.5" />
          {uploadLabel}
          <input
            type="file"
            accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
            disabled={isUploading}
            className="sr-only"
            onChange={handleFileChange}
          />
        </label>
        {displayValue && !isUploading && (
          <Button
            variant="ghost"
            size="lg"
            className="text-muted-foreground"
            onClick={handleRemove}
          >
            {removeLabel}
          </Button>
        )}
      </div>
      {description && <p className="text-muted-foreground text-xs">{description}</p>}
      {error && <p className="text-destructive text-sm">{getFieldError(error)}</p>}
    </div>
  );
}
