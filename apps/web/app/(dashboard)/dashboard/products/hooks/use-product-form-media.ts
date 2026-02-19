import { useCallback, useMemo, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';

import { useTranslations } from 'next-intl';

import { toastManager } from '@louez/ui';

import type { ProductFormComponentApi } from '../types';
import {
  createMaxCenteredAspectCropPercent,
  createCroppedDataUrl,
  getCropSizePercentFromRect,
  getImageSizeFromSource,
  getPixelCropFromPercentRect,
  isCropSupportedMime,
  type ProductImagePercentCropRect,
  type ProductImagePixelCropRect,
  type ProductImageSize,
  readFileAsDataUrl,
} from '../utils/product-image-crop';

interface UseProductFormMediaParams {
  form: ProductFormComponentApi;
  imagesPreviews: string[];
}

const MAX_PRODUCT_IMAGES = 5;
const MAX_IMAGE_SIZE_BYTES = 15 * 1024 * 1024;

interface PreparedUploadImage {
  id: string;
  order: number;
  dataUrl: string;
}

type CropSessionMode = 'append' | 'replace';

export interface ProductImageCropQueueItem {
  id: string;
  order: number;
  mimeType: string;
  originalDataUrl: string;
  imageSize: ProductImageSize;
  crop: ProductImagePercentCropRect;
  cropSizePercent: number;
  croppedAreaPixels: ProductImagePixelCropRect | null;
  resultMode: 'cropped' | 'original';
}

function createCandidateId(index: number) {
  return `product-image-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useProductFormMedia({
  form,
  imagesPreviews,
}: UseProductFormMediaParams) {
  const t = useTranslations('dashboard.products.form');

  const [isDragging, setIsDragging] = useState(false);
  const [isPreparingSession, setIsPreparingSession] = useState(false);
  const [isUploadingToServer, setIsUploadingToServer] = useState(false);

  const [isCropDialogOpen, setIsCropDialogOpen] = useState(false);
  const [selectedCropIndex, setSelectedCropIndex] = useState(0);
  const [cropQueueItems, setCropQueueItems] = useState<
    ProductImageCropQueueItem[]
  >([]);
  const [passthroughQueueItems, setPassthroughQueueItems] = useState<
    PreparedUploadImage[]
  >([]);
  const [cropSessionMode, setCropSessionMode] =
    useState<CropSessionMode>('append');
  const [replaceImageIndex, setReplaceImageIndex] = useState<number | null>(
    null,
  );

  const isUploadingImages = isPreparingSession || isUploadingToServer;

  const currentCropItem = useMemo(
    () => cropQueueItems[selectedCropIndex] ?? null,
    [cropQueueItems, selectedCropIndex],
  );

  const canGoToPreviousCropItem = selectedCropIndex > 0;
  const canGoToNextCropItem = selectedCropIndex < cropQueueItems.length - 1;

  const resetCropSession = useCallback(() => {
    setIsCropDialogOpen(false);
    setSelectedCropIndex(0);
    setCropQueueItems([]);
    setPassthroughQueueItems([]);
    setCropSessionMode('append');
    setReplaceImageIndex(null);
  }, []);

  const uploadPreparedImages = useCallback(
    async (
      preparedImages: PreparedUploadImage[],
      options?: { mode?: CropSessionMode; replaceIndex?: number | null },
    ): Promise<boolean> => {
      if (preparedImages.length === 0) return false;

      setIsUploadingToServer(true);
      const uploadedUrls: { order: number; url: string }[] = [];

      try {
        for (let index = 0; index < preparedImages.length; index += 1) {
          const prepared = preparedImages[index];

          const response = await fetch('/api/upload/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: prepared.dataUrl,
              type: 'product',
              filename: `product-${Date.now()}-${prepared.order}`,
            }),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
          }

          const { url } = await response.json();
          uploadedUrls.push({ order: prepared.order, url });
        }

        if (uploadedUrls.length > 0) {
          const orderedUploadedUrls = uploadedUrls
            .sort((a, b) => a.order - b.order)
            .map((item) => item.url);

          if (
            options?.mode === 'replace' &&
            options.replaceIndex != null &&
            options.replaceIndex >= 0 &&
            options.replaceIndex < imagesPreviews.length
          ) {
            const updatedImages = [...imagesPreviews];
            updatedImages.splice(
              options.replaceIndex,
              Math.max(1, orderedUploadedUrls.length),
              ...orderedUploadedUrls,
            );
            form.setFieldValue('images', updatedImages);
          } else {
            form.setFieldValue('images', [
              ...imagesPreviews,
              ...orderedUploadedUrls,
            ]);
          }
        }

        return uploadedUrls.length > 0;
      } catch (error) {
        console.error('Image upload error:', error);
        toastManager.add({ title: t('imageUploadError'), type: 'error' });
        return false;
      } finally {
        setIsUploadingToServer(false);
      }
    },
    [form, imagesPreviews, t],
  );

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const remainingSlots = Math.max(
        0,
        MAX_PRODUCT_IMAGES - imagesPreviews.length,
      );
      const filesToProcess = fileArray.slice(0, remainingSlots);

      if (filesToProcess.length === 0) return;

      setIsPreparingSession(true);

      const nextCropQueueItems: ProductImageCropQueueItem[] = [];
      const nextPassthroughItems: PreparedUploadImage[] = [];

      try {
        for (let index = 0; index < filesToProcess.length; index += 1) {
          const file = filesToProcess[index];

          if (!file.type.startsWith('image/')) {
            toastManager.add({ title: t('imageError'), type: 'error' });
            continue;
          }

          if (file.size > MAX_IMAGE_SIZE_BYTES) {
            toastManager.add({ title: t('imageSizeError'), type: 'error' });
            continue;
          }

          const candidateId = createCandidateId(index);
          const dataUrl = await readFileAsDataUrl(file);
          const mimeType = file.type.toLowerCase();

          if (isCropSupportedMime(mimeType)) {
            const imageSize = await getImageSizeFromSource(dataUrl);
            const initialCrop = createMaxCenteredAspectCropPercent(imageSize);
            nextCropQueueItems.push({
              id: candidateId,
              order: index,
              mimeType,
              originalDataUrl: dataUrl,
              imageSize,
              crop: initialCrop,
              cropSizePercent: 100,
              croppedAreaPixels: getPixelCropFromPercentRect(
                initialCrop,
                imageSize,
              ),
              resultMode: 'original',
            });
          } else {
            nextPassthroughItems.push({
              id: candidateId,
              order: index,
              dataUrl,
            });
          }
        }

        if (nextCropQueueItems.length === 0) {
          const orderedPassthroughImages = [...nextPassthroughItems].sort(
            (a, b) => a.order - b.order,
          );
          await uploadPreparedImages(orderedPassthroughImages);
          return;
        }

        setCropQueueItems(nextCropQueueItems.sort((a, b) => a.order - b.order));
        setPassthroughQueueItems(nextPassthroughItems);
        setCropSessionMode('append');
        setReplaceImageIndex(null);
        setSelectedCropIndex(0);
        setIsCropDialogOpen(true);
      } catch (error) {
        console.error('Image processing error:', error);
        toastManager.add({ title: t('imageUploadError'), type: 'error' });
      } finally {
        setIsPreparingSession(false);
      }
    },
    [imagesPreviews.length, t, uploadPreparedImages],
  );

  const handleImageUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!event.target.files) return;

      void processFiles(event.target.files);
      event.target.value = '';
    },
    [processFiles],
  );

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);

      if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
        void processFiles(event.dataTransfer.files);
      }
    },
    [processFiles],
  );

  const removeImage = useCallback(
    (index: number) => {
      form.setFieldValue(
        'images',
        imagesPreviews.filter((_, currentIndex) => currentIndex !== index),
      );
    },
    [form, imagesPreviews],
  );

  const setMainImage = useCallback(
    (index: number) => {
      if (index === 0) return;

      const updated = [...imagesPreviews];
      const [moved] = updated.splice(index, 1);
      updated.unshift(moved);
      form.setFieldValue('images', updated);
    },
    [form, imagesPreviews],
  );

  const setCropRect = useCallback(
    (itemId: string, crop: ProductImagePercentCropRect) => {
      setCropQueueItems((prev) =>
        prev.map((item) => {
          if (item.id !== itemId) return item;

          return {
            ...item,
            crop,
            cropSizePercent: getCropSizePercentFromRect(crop, item.imageSize),
          };
        }),
      );
    },
    [],
  );

  const setCropSizePercent = useCallback(
    (itemId: string, cropSizePercent: number) => {
      setCropQueueItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, cropSizePercent } : item,
        ),
      );
    },
    [],
  );

  const setCropAreaPixels = useCallback(
    (itemId: string, croppedAreaPixels: ProductImagePixelCropRect) => {
      setCropQueueItems((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? {
                ...item,
                croppedAreaPixels,
              }
            : item,
        ),
      );
    },
    [],
  );

  const goToPreviousCropItem = useCallback(() => {
    if (!canGoToPreviousCropItem) return;
    setSelectedCropIndex((prev) => prev - 1);
  }, [canGoToPreviousCropItem]);

  const goToNextCropItem = useCallback(() => {
    if (!canGoToNextCropItem) return;
    setSelectedCropIndex((prev) => prev + 1);
  }, [canGoToNextCropItem]);

  const closeCropDialog = useCallback(() => {
    if (isUploadingToServer) return;
    resetCropSession();
  }, [isUploadingToServer, resetCropSession]);

  const recropImage = useCallback(
    async (index: number) => {
      const imageUrl = imagesPreviews[index];
      if (!imageUrl) return;

      setIsPreparingSession(true);

      try {
        const response = await fetch('/api/upload/image/source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: imageUrl }),
        });
        if (!response.ok) {
          throw new Error('Failed to load existing image');
        }

        const payload = (await response.json()) as {
          dataUrl?: string;
          mimeType?: string;
        };
        const dataUrl = payload.dataUrl;
        const mimeType = (payload.mimeType || 'image/jpeg').toLowerCase();

        if (!dataUrl) {
          throw new Error('Missing source image data');
        }

        if (!isCropSupportedMime(mimeType)) {
          toastManager.add({
            title: t('cropUnsupportedFormat'),
            type: 'error',
          });
          return;
        }

        const imageSize = await getImageSizeFromSource(dataUrl);
        const initialCrop = createMaxCenteredAspectCropPercent(imageSize);

        setCropQueueItems([
          {
            id: createCandidateId(index),
            order: 0,
            mimeType,
            originalDataUrl: dataUrl,
            imageSize,
            crop: initialCrop,
            cropSizePercent: 100,
            croppedAreaPixels: getPixelCropFromPercentRect(
              initialCrop,
              imageSize,
            ),
            resultMode: 'cropped',
          },
        ]);
        setPassthroughQueueItems([]);
        setCropSessionMode('replace');
        setReplaceImageIndex(index);
        setSelectedCropIndex(0);
        setIsCropDialogOpen(true);
      } catch (error) {
        console.error('Image recrop prepare error:', error);
        toastManager.add({ title: t('imageUploadError'), type: 'error' });
      } finally {
        setIsPreparingSession(false);
      }
    },
    [imagesPreviews, t],
  );

  const uploadCropQueue = useCallback(
    async (queueItems: ProductImageCropQueueItem[]) => {
      if (queueItems.length === 0) {
        resetCropSession();
        return;
      }

      const preparedCropImages: PreparedUploadImage[] = [];

      try {
        for (const item of queueItems) {
          let preparedDataUrl = item.originalDataUrl;

          if (item.resultMode === 'cropped' && item.croppedAreaPixels) {
            preparedDataUrl = await createCroppedDataUrl({
              imageSrc: item.originalDataUrl,
              croppedAreaPixels: item.croppedAreaPixels,
              mimeType: item.mimeType,
            });
          }

          preparedCropImages.push({
            id: item.id,
            order: item.order,
            dataUrl: preparedDataUrl,
          });
        }

        const allPreparedImages = [
          ...preparedCropImages,
          ...passthroughQueueItems,
        ].sort((a, b) => a.order - b.order);

        const didUpload = await uploadPreparedImages(allPreparedImages, {
          mode: cropSessionMode,
          replaceIndex: replaceImageIndex,
        });
        if (didUpload) {
          resetCropSession();
        }
      } catch (error) {
        console.error('Image crop error:', error);
        toastManager.add({ title: t('imageUploadError'), type: 'error' });
      }
    },
    [
      cropSessionMode,
      passthroughQueueItems,
      replaceImageIndex,
      resetCropSession,
      t,
      uploadPreparedImages,
    ],
  );

  const applyCurrentCropChoice = useCallback(
    async (nextResultMode: 'cropped' | 'original') => {
      const activeItem = cropQueueItems[selectedCropIndex];
      if (!activeItem) return;

      const updatedQueue = cropQueueItems.map((item) =>
        item.id === activeItem.id
          ? {
              ...item,
              resultMode: nextResultMode,
            }
          : item,
      );

      setCropQueueItems(updatedQueue);

      if (selectedCropIndex < updatedQueue.length - 1) {
        setSelectedCropIndex((prev) => prev + 1);
        return;
      }

      await uploadCropQueue(updatedQueue);
    },
    [cropQueueItems, selectedCropIndex, uploadCropQueue],
  );

  const applyCurrentCropAndProceed = useCallback(() => {
    void applyCurrentCropChoice('cropped');
  }, [applyCurrentCropChoice]);

  const keepCurrentCropOriginalAndProceed = useCallback(() => {
    void applyCurrentCropChoice('original');
  }, [applyCurrentCropChoice]);

  const replaceCurrentCropImage = useCallback(
    async (file: File) => {
      if (selectedCropIndex < 0 || selectedCropIndex >= cropQueueItems.length) {
        return;
      }

      if (!file.type.startsWith('image/')) {
        toastManager.add({ title: t('imageError'), type: 'error' });
        return;
      }

      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        toastManager.add({ title: t('imageSizeError'), type: 'error' });
        return;
      }

      const mimeType = file.type.toLowerCase();
      if (!isCropSupportedMime(mimeType)) {
        toastManager.add({ title: t('cropUnsupportedFormat'), type: 'error' });
        return;
      }

      setIsPreparingSession(true);
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const imageSize = await getImageSizeFromSource(dataUrl);
        const initialCrop = createMaxCenteredAspectCropPercent(imageSize);
        const initialPixels = getPixelCropFromPercentRect(initialCrop, imageSize);

        setCropQueueItems((prev) =>
          prev.map((item, index) =>
            index === selectedCropIndex
              ? {
                  ...item,
                  mimeType,
                  originalDataUrl: dataUrl,
                  imageSize,
                  crop: initialCrop,
                  cropSizePercent: 100,
                  croppedAreaPixels: initialPixels,
                  resultMode: 'cropped',
                }
              : item,
          ),
        );
      } catch (error) {
        console.error('Image replace error:', error);
        toastManager.add({ title: t('imageUploadError'), type: 'error' });
      } finally {
        setIsPreparingSession(false);
      }
    },
    [cropQueueItems.length, selectedCropIndex, t],
  );

  const uploadCropSession = useCallback(async () => {
    await uploadCropQueue(cropQueueItems);
  }, [cropQueueItems, uploadCropQueue]);

  return {
    isDragging,
    isUploadingImages,
    isCropDialogOpen,
    cropQueueItems,
    selectedCropIndex,
    currentCropItem,
    canGoToPreviousCropItem,
    canGoToNextCropItem,
    processFiles,
    handleImageUpload,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    removeImage,
    setMainImage,
    recropImage,
    setSelectedCropIndex,
    setCropRect,
    setCropSizePercent,
    setCropAreaPixels,
    applyCurrentCropAndProceed,
    keepCurrentCropOriginalAndProceed,
    replaceCurrentCropImage,
    goToPreviousCropItem,
    goToNextCropItem,
    closeCropDialog,
    uploadCropSession,
  };
}
