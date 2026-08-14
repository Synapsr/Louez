"use client";

import { ImageIcon, Loader2, Upload, X } from "lucide-react";

import { Button, buttonVariants } from "@louez/ui";

import { cn } from "@/lib/utils";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/uploads/image-upload";

interface CategoryImageControlProps {
  imageUrl: string | null;
  label: string;
  uploadLabel: string;
  removeLabel: string;
  isUploading: boolean;
  onFileSelected: (file: File) => void | Promise<void>;
  onRemove: () => void;
}

export const CategoryImageControl = ({
  imageUrl,
  label,
  uploadLabel,
  removeLabel,
  isUploading,
  onFileSelected,
  onRemove,
}: CategoryImageControlProps) => {
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void onFileSelected(file);
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-3">
        <div className="bg-muted/50 flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border">
          {isUploading ? (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          ) : imageUrl ? (
            <img src={imageUrl} alt="" className="size-full object-cover" />
          ) : (
            <ImageIcon className="text-muted-foreground size-4" />
          )}
        </div>
        <label
          aria-disabled={isUploading}
          className={cn(
            buttonVariants({ size: "sm", variant: "outline" }),
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
        {imageUrl && !isUploading && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={onRemove}
          >
            <X className="size-3.5" />
            {removeLabel}
          </Button>
        )}
      </div>
    </div>
  );
};
