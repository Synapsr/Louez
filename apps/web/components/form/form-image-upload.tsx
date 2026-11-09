"use client";

import { useState } from "react";

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
  /**
   * `dropzone` turns the field into a drop area that also opens the file
   * picker on click; `dropzoneTitle` is its call to action.
   */
  variant?: "inline" | "dropzone";
  dropzoneTitle?: React.ReactNode;
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
  variant = "inline",
  dropzoneTitle,
  onFileSelected,
  onRemove,
}: FormImageUploadProps) {
  const field = useFieldContext<string | null>();
  const [isDragging, setIsDragging] = useState(false);
  const value = field.state.value || null;
  const displayValue = previewUrl || value;
  const errors = field.state.meta.errors;
  const error = errors[0];

  const handleFile = async (file: File | undefined) => {
    if (!file) return;

    const issue = getImageUploadIssue(file, kind);
    if (issue) {
      toastManager.add({ title: messages[issue], type: "error" });
      return;
    }

    await onFileSelected(file);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    await handleFile(file);
  };

  const handleRemove = onRemove ?? (() => field.handleChange(null));

  const fileInput = (
    <input
      type="file"
      accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
      disabled={isUploading}
      className="sr-only"
      onChange={handleFileChange}
    />
  );

  const previewSlot = (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden",
        variant === "dropzone"
          ? "bg-card shadow-card size-11 rounded-xl"
          : cn("border", shape === "circle" ? "size-12 rounded-full" : "bg-muted/50 size-10 rounded-lg"),
      )}
    >
      {isUploading ? (
        <Loader2 className="text-muted-foreground size-4 animate-spin" />
      ) : displayValue ? (
        <img src={displayValue} alt="" className="size-full object-cover" />
      ) : variant === "dropzone" ? (
        <Upload className="text-primary size-5" />
      ) : (
        (fallback ?? <ImageIcon className="text-muted-foreground size-4" />)
      )}
    </div>
  );

  if (variant === "dropzone") {
    return (
      <div className="space-y-2">
        {label && <Label data-error={errors.length > 0}>{label}</Label>}
        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            if (!isUploading) void handleFile(event.dataTransfer.files[0]);
          }}
          className={cn(
            "ease-lagon flex items-center gap-3.5 rounded-2xl border-[1.5px] p-4 transition-[border-color,background-color,scale] duration-200",
            displayValue
              ? "bg-card border-border border-solid"
              : "bg-muted/60 border-input hover:border-primary/60 hover:bg-accent border-dashed",
            isDragging && "border-primary bg-accent scale-[1.01]",
          )}
        >
          {previewSlot}
          <label
            aria-disabled={isUploading}
            className={cn(
              "flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 text-sm",
              isUploading && "pointer-events-none",
            )}
          >
            <span className="font-semibold">{displayValue ? uploadLabel : dropzoneTitle}</span>
            {description && <span className="text-muted-foreground text-xs">{description}</span>}
            {fileInput}
          </label>
          {displayValue && !isUploading && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={handleRemove}>
              {removeLabel}
            </Button>
          )}
        </div>
        {error && <p className="text-destructive text-sm">{getFieldError(error)}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {label && <Label data-error={errors.length > 0}>{label}</Label>}
      <div className="flex items-center gap-3">
        {previewSlot}
        <label
          aria-disabled={isUploading}
          className={cn(
            buttonVariants({ size: "lg", variant: "outline" }),
            isUploading && "pointer-events-none opacity-50",
          )}
        >
          <Upload className="size-3.5" />
          {uploadLabel}
          {fileInput}
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
