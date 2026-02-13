export const PRODUCT_IMAGE_ASPECT_RATIO = 4 / 3;
export const PRODUCT_IMAGE_CROP_REQUIRED = false;
const CROP_SIZE_PERCENT_MIN = 20;
const CROP_SIZE_PERCENT_MAX = 100;

const CROP_SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export interface ProductImageSize {
  width: number;
  height: number;
}

export interface ProductImagePercentCropRect {
  unit: '%';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProductImagePixelCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function isCropSupportedMime(mimeType: string): boolean {
  return CROP_SUPPORTED_MIME_TYPES.has(mimeType.toLowerCase());
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(reader.result as string);
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsDataURL(file);
  });
}

export function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(reader.result as string);
    };

    reader.onerror = () => {
      reject(new Error('Failed to read blob'));
    };

    reader.readAsDataURL(blob);
  });
}

async function loadImage(imageSrc: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image'));
    image.src = imageSrc;
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export async function getImageSizeFromSource(
  imageSrc: string,
): Promise<ProductImageSize> {
  const image = await loadImage(imageSrc);
  return { width: image.naturalWidth, height: image.naturalHeight };
}

export function createMaxCenteredAspectCropPercent(
  imageSize: ProductImageSize,
  aspect = PRODUCT_IMAGE_ASPECT_RATIO,
): ProductImagePercentCropRect {
  const imageAspect = imageSize.width / imageSize.height;

  if (imageAspect >= aspect) {
    const width = (aspect / imageAspect) * 100;
    return {
      unit: '%',
      x: round((100 - width) / 2),
      y: 0,
      width: round(width),
      height: 100,
    };
  }

  const height = (imageAspect / aspect) * 100;
  return {
    unit: '%',
    x: 0,
    y: round((100 - height) / 2),
    width: 100,
    height: round(height),
  };
}

export function scaleCropRectToPercent({
  crop,
  imageSize,
  cropSizePercent,
  aspect = PRODUCT_IMAGE_ASPECT_RATIO,
}: {
  crop: ProductImagePercentCropRect;
  imageSize: ProductImageSize;
  cropSizePercent: number;
  aspect?: number;
}): ProductImagePercentCropRect {
  const maxCrop = createMaxCenteredAspectCropPercent(imageSize, aspect);
  const normalizedPercent = clamp(
    cropSizePercent,
    CROP_SIZE_PERCENT_MIN,
    CROP_SIZE_PERCENT_MAX,
  );
  const ratio = normalizedPercent / 100;
  const width = maxCrop.width * ratio;
  const height = maxCrop.height * ratio;
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  const maxX = Math.max(0, 100 - width);
  const maxY = Math.max(0, 100 - height);
  const x = clamp(centerX - width / 2, 0, maxX);
  const y = clamp(centerY - height / 2, 0, maxY);

  return {
    unit: '%',
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
  };
}

export function getCropSizePercentFromRect(
  crop: ProductImagePercentCropRect,
  imageSize: ProductImageSize,
  aspect = PRODUCT_IMAGE_ASPECT_RATIO,
): number {
  const maxCrop = createMaxCenteredAspectCropPercent(imageSize, aspect);
  if (maxCrop.width <= 0) return CROP_SIZE_PERCENT_MAX;
  const percent = (crop.width / maxCrop.width) * 100;
  return Math.round(clamp(percent, CROP_SIZE_PERCENT_MIN, CROP_SIZE_PERCENT_MAX));
}

export function normalizePercentCropRect(
  crop: Partial<ProductImagePercentCropRect>,
  fallback: ProductImagePercentCropRect,
): ProductImagePercentCropRect {
  const nextWidth = clamp(
    crop.width ?? fallback.width,
    CROP_SIZE_PERCENT_MIN / 4,
    100,
  );
  const nextHeight = clamp(
    crop.height ?? fallback.height,
    CROP_SIZE_PERCENT_MIN / 4,
    100,
  );
  const maxX = Math.max(0, 100 - nextWidth);
  const maxY = Math.max(0, 100 - nextHeight);

  return {
    unit: '%',
    x: round(clamp(crop.x ?? fallback.x, 0, maxX)),
    y: round(clamp(crop.y ?? fallback.y, 0, maxY)),
    width: round(nextWidth),
    height: round(nextHeight),
  };
}

export function getPixelCropFromPercentRect(
  crop: ProductImagePercentCropRect,
  imageSize: ProductImageSize,
): ProductImagePixelCropRect {
  const width = Math.max(1, Math.round((crop.width / 100) * imageSize.width));
  const height = Math.max(1, Math.round((crop.height / 100) * imageSize.height));
  const x = Math.round((crop.x / 100) * imageSize.width);
  const y = Math.round((crop.y / 100) * imageSize.height);
  const maxX = Math.max(0, imageSize.width - width);
  const maxY = Math.max(0, imageSize.height - height);

  return {
    x: clamp(x, 0, maxX),
    y: clamp(y, 0, maxY),
    width,
    height,
  };
}

interface CreateCroppedDataUrlParams {
  imageSrc: string;
  croppedAreaPixels: ProductImagePixelCropRect;
  mimeType: string;
  quality?: number;
}

export async function createCroppedDataUrl({
  imageSrc,
  croppedAreaPixels,
  mimeType,
  quality = 0.92,
}: CreateCroppedDataUrlParams): Promise<string> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Failed to create canvas context');
  }

  const width = Math.max(1, Math.round(croppedAreaPixels.width));
  const height = Math.max(1, Math.round(croppedAreaPixels.height));
  const x = Math.round(croppedAreaPixels.x);
  const y = Math.round(croppedAreaPixels.y);

  canvas.width = width;
  canvas.height = height;

  context.drawImage(image, x, y, width, height, 0, 0, width, height);

  const outputMimeType = isCropSupportedMime(mimeType)
    ? mimeType
    : 'image/jpeg';
  return canvas.toDataURL(outputMimeType, quality);
}
