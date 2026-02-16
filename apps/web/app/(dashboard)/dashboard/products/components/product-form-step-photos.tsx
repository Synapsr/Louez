'use client';

import type { ChangeEvent, DragEvent } from 'react';

import {
  Crop,
  ImageIcon,
  Loader2,
  Plus,
  Star,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
} from '@louez/ui';

import { getFieldError } from '@/hooks/form/form-context';

import type { ProductFormComponentApi } from '../types';

interface ProductFormStepPhotosProps {
  form: ProductFormComponentApi;
  imagesPreviews: string[];
  isDragging: boolean;
  isUploadingImages: boolean;
  handleImageUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  handleDragOver: (event: DragEvent) => void;
  handleDragEnter: (event: DragEvent) => void;
  handleDragLeave: (event: DragEvent) => void;
  handleDrop: (event: DragEvent) => void;
  removeImage: (index: number) => void;
  setMainImage: (index: number) => void;
  recropImage: (index: number) => void;
  canRecrop: boolean;
}

export function ProductFormStepPhotos({
  form,
  imagesPreviews,
  isDragging,
  isUploadingImages,
  handleImageUpload,
  handleDragOver,
  handleDragEnter,
  handleDragLeave,
  handleDrop,
  removeImage,
  setMainImage,
  recropImage,
  canRecrop,
}: ProductFormStepPhotosProps) {
  const t = useTranslations('dashboard.products.form');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5" />
          {t('photos')}
        </CardTitle>
        <CardDescription>{t('photosDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form.Field name="images">
          {(field) => (
            <div>
              <div className="space-y-4">
                {imagesPreviews.length === 0 && (
                  <label
                    className={`bg-muted/20 flex h-48 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
                      isUploadingImages
                        ? 'border-primary bg-primary/10 cursor-wait'
                        : isDragging
                          ? 'border-primary bg-primary/10'
                          : 'border-muted-foreground/25 hover:border-primary/50'
                    }`}
                    onDragOver={handleDragOver}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    {isUploadingImages ? (
                      <>
                        <Loader2 className="text-primary mb-3 h-10 w-10 animate-spin" />
                        <span className="text-sm font-medium">
                          {t('uploading')}
                        </span>
                      </>
                    ) : (
                      <>
                        <Upload
                          className={`mb-3 h-10 w-10 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`}
                        />
                        <span className="text-sm font-medium">
                          {t('addImage')}
                        </span>
                        <span className="text-muted-foreground mt-1 text-xs">
                          {t('dragImages')}
                        </span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      onChange={handleImageUpload}
                      disabled={isUploadingImages}
                    />
                  </label>
                )}

                {imagesPreviews.length > 0 && (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {imagesPreviews.map((preview, index) => (
                      <div key={index} className="group relative aspect-[4/3]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={preview}
                          alt={`Product image ${index + 1}`}
                          className="h-full w-full rounded-lg border object-cover"
                        />
                        <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-lg bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                          {index !== 0 && (
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setMainImage(index)}
                              title={t('setAsMain')}
                            >
                              <Star className="h-4 w-4" />
                            </Button>
                          )}
                          {canRecrop && (
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => recropImage(index)}
                              title={t('recropImage')}
                            >
                              <Crop className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => removeImage(index)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        {index === 0 && (
                          <Badge
                            className="absolute -top-2 -left-2"
                            variant="default"
                          >
                            {t('mainBadge')}
                          </Badge>
                        )}
                      </div>
                    ))}

                    {imagesPreviews.length < 5 && (
                      <label
                        className={`flex aspect-[4/3] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
                          isUploadingImages
                            ? 'border-primary bg-primary/10 cursor-wait'
                            : isDragging
                              ? 'border-primary bg-primary/10'
                              : 'border-muted-foreground/25 hover:border-primary/50'
                        }`}
                        onDragOver={handleDragOver}
                        onDragEnter={handleDragEnter}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                      >
                        {isUploadingImages ? (
                          <Loader2 className="text-primary h-6 w-6 animate-spin" />
                        ) : (
                          <>
                            <Plus
                              className={`h-6 w-6 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`}
                            />
                            <span className="text-muted-foreground mt-1 text-xs">
                              {t('addImage')}
                            </span>
                          </>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="sr-only"
                          onChange={handleImageUpload}
                          disabled={isUploadingImages}
                        />
                      </label>
                    )}
                  </div>
                )}

                <p className="text-muted-foreground text-xs">
                  {t('imagesHint', { count: 5 - imagesPreviews.length })}
                </p>
              </div>
              {field.state.meta.errors.length > 0 && (
                <p className="text-destructive text-sm font-medium">
                  {getFieldError(field.state.meta.errors[0])}
                </p>
              )}
            </div>
          )}
        </form.Field>

        <div className="border-t pt-4">
          <form.AppField name="videoUrl">
            {(field) => (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Video className="h-4 w-4" />
                  {t('videoUrl')}
                </Label>
                <field.Input placeholder={t('videoUrlPlaceholder')} />
                <p className="text-muted-foreground text-sm">
                  {t('videoUrlHelp')}
                </p>
              </div>
            )}
          </form.AppField>
        </div>
      </CardContent>
    </Card>
  );
}
