'use client';

import { ImageIcon, Loader2, Upload } from 'lucide-react';

import { Button, Label, buttonVariants, toastManager } from '@louez/ui';
import { cn } from '@louez/utils';

import {
  type ImageFileIssue,
  getImageFileIssue,
  readFileAsDataUri,
} from '@/lib/utils/util.image-file';

import { getFieldError, useFieldContext } from '@/hooks/form/form-context';

interface FormImageUploadProps {
  label?: string;
  description?: string;
  uploadLabel: string;
  removeLabel: string;
  /** Toast messages shown when the selected file is rejected or unreadable. */
  messages: Record<ImageFileIssue | 'readFailed', string>;
  /** Rendered in the preview slot when the field is empty. */
  fallback?: React.ReactNode;
  shape?: 'circle' | 'square';
  /** Show a spinner in the preview slot (e.g. while an async upload runs). */
  isUploading?: boolean;
  /** Override what happens with the selected file (default: put the data URI in the field). */
  onFileSelected?: (dataUri: string) => void | Promise<void>;
  /** Override removal (default: set the field to null). */
  onRemove?: () => void;
}

export function FormImageUpload({
  label,
  description,
  uploadLabel,
  removeLabel,
  messages,
  fallback,
  shape = 'square',
  isUploading = false,
  onFileSelected,
  onRemove,
}: FormImageUploadProps) {
  const field = useFieldContext<string | null>();
  const value = field.state.value || null;
  const errors = field.state.meta.errors;
  const error = errors[0];

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    const issue = getImageFileIssue(file);
    if (issue) {
      toastManager.add({ title: messages[issue], type: 'error' });
      return;
    }

    try {
      const dataUri = await readFileAsDataUri(file);
      if (onFileSelected) {
        await onFileSelected(dataUri);
      } else {
        field.handleChange(dataUri);
      }
    } catch {
      toastManager.add({ title: messages.readFailed, type: 'error' });
    }
  };

  const handleRemove = onRemove ?? (() => field.handleChange(null));

  return (
    <div className="space-y-2">
      {label && <Label data-error={errors.length > 0}>{label}</Label>}
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex shrink-0 items-center justify-center overflow-hidden border',
            shape === 'circle'
              ? 'size-12 rounded-full'
              : 'bg-muted/50 size-10 rounded-lg',
          )}
        >
          {isUploading ? (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          ) : value ? (
            <img
              src={value}
              alt=""
              className={cn(
                'size-full',
                shape === 'circle' ? 'object-cover' : 'object-contain',
              )}
            />
          ) : (
            (fallback ?? <ImageIcon className="text-muted-foreground size-4" />)
          )}
        </div>
        <label className={buttonVariants({ size: 'lg', variant: 'outline' })}>
          <Upload className="size-3.5" />
          {uploadLabel}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleFileChange}
          />
        </label>
        {value && !isUploading && (
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
      {description && (
        <p className="text-muted-foreground text-xs">{description}</p>
      )}
      {error && (
        <p className="text-destructive text-sm">{getFieldError(error)}</p>
      )}
    </div>
  );
}
