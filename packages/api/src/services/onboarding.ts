import { eq } from 'drizzle-orm';

import { db, stores } from '@louez/db';
import {
  type AllowedImageType,
  type BrandingInput,
  MAX_HERO_SIZE,
  MAX_IMAGE_SIZE,
  MAX_LOGO_SIZE,
  type StripeSetupInput,
  estimateBase64Size,
  extractBase64,
  validateDataUri,
} from '@louez/validations';

import { ApiServiceError } from './errors';

interface UpdateOnboardingBrandingParams {
  storeId: string;
  input: BrandingInput;
}

interface CompleteOnboardingParams {
  storeId: string;
  input: StripeSetupInput;
  notifyStoreCreated?: (store: {
    id: string;
    name: string;
    slug: string;
  }) => Promise<void>;
}

interface UploadOnboardingImageParams {
  storeId: string;
  image: string;
  type: 'logo' | 'hero' | 'product';
  filename?: string;
  uploadImageToStorage: (params: {
    key: string;
    body: Buffer;
    contentType: string;
  }) => Promise<string>;
  getStorageKey: (
    storeId: string,
    type: 'logo' | 'products' | 'documents' | 'inspections',
    ...parts: string[]
  ) => string;
}

const MIME_TO_EXT: Record<AllowedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

const SIZE_LIMITS = {
  logo: MAX_LOGO_SIZE,
  hero: MAX_HERO_SIZE,
  product: MAX_IMAGE_SIZE,
} as const;

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/\.\./g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 50);
}

function formatSizeLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))}MB`;
  }
  return `${Math.round(bytes / 1024)}KB`;
}

export async function updateOnboardingBranding(
  params: UpdateOnboardingBrandingParams,
) {
  const { storeId, input } = params;

  await db
    .update(stores)
    .set({
      logoUrl: input.logoUrl || null,
      theme: {
        mode: input.theme,
        primaryColor: input.primaryColor,
      },
      updatedAt: new Date(),
    })
    .where(eq(stores.id, storeId));

  return { success: true as const };
}

export async function completeOnboarding(params: CompleteOnboardingParams) {
  const { storeId, input, notifyStoreCreated } = params;

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
  });

  if (!store) {
    throw new ApiServiceError('NOT_FOUND', 'errors.storeNotFound');
  }

  const currentSettings = store.settings || {
    minRentalMinutes: 60,
    maxRentalMinutes: null,
    advanceNoticeMinutes: 1440,
    openingHours: null,
  };

  await db
    .update(stores)
    .set({
      settings: {
        ...currentSettings,
        reservationMode: input.reservationMode,
      },
      onboardingCompleted: true,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, storeId));

  if (notifyStoreCreated) {
    notifyStoreCreated({
      id: storeId,
      name: store.name,
      slug: store.slug,
    }).catch(() => {});
  }

  return { success: true as const };
}

export async function uploadOnboardingImage(
  params: UploadOnboardingImageParams,
) {
  const {
    storeId,
    image,
    type,
    filename,
    uploadImageToStorage,
    getStorageKey,
  } = params;

  const mimeType = validateDataUri(image);
  if (!mimeType) {
    throw new ApiServiceError('BAD_REQUEST', 'errors.invalidData');
  }

  const base64Data = extractBase64(image);
  if (!base64Data) {
    throw new ApiServiceError('BAD_REQUEST', 'errors.invalidData');
  }

  const fileSize = estimateBase64Size(base64Data);
  const maxSize = SIZE_LIMITS[type];

  if (fileSize > maxSize) {
    throw new ApiServiceError(
      'BAD_REQUEST',
      `Image too large. Maximum size for ${type} is ${formatSizeLimit(maxSize)}.`,
    );
  }

  const extension = MIME_TO_EXT[mimeType] || 'jpg';
  const uniqueId = crypto.randomUUID().slice(0, 10);
  const safeFilename = filename ? sanitizeFilename(filename) : type;
  const finalFilename = `${safeFilename}-${uniqueId}.${extension}`;
  const storageType = type === 'product' ? 'products' : 'logo';
  const key = getStorageKey(storeId, storageType, finalFilename);

  const buffer = Buffer.from(base64Data, 'base64');
  const url = await uploadImageToStorage({
    key,
    body: buffer,
    contentType: mimeType,
  });

  return {
    url,
    key,
    filename: finalFilename,
    size: fileSize,
    mimeType,
  };
}
