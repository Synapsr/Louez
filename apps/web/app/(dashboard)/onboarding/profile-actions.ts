'use server';

import { eq, sql } from 'drizzle-orm';

import { db, users } from '@louez/db';
import {
  type AcquisitionInput,
  type AllowedImageType,
  MAX_LOGO_SIZE,
  type ProfileInput,
  acquisitionSchema,
  estimateBase64Size,
  extractBase64,
  profileSchema,
  validateDataUri,
} from '@louez/validations';

import { auth } from '@/lib/auth';
import { captureProductServerEvent } from '@/lib/product-analytics/analytics';
import { productAnalyticsEvents } from '@/lib/product-analytics/analytics-events';
import { uploadFile } from '@/lib/storage/client';

const MIME_TO_EXT: Record<AllowedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

interface UpdateUserProfileInput extends ProfileInput {
  // undefined = keep the current image, null = remove it, string = new data URI
  imageDataUri?: string | null;
}

export async function updateUserProfile(input: UpdateUserProfileInput) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: 'errors.unauthorized' };
  }

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'errors.invalidData' };
  }

  let imageUrl: string | null | undefined;
  if (input.imageDataUri === null) {
    imageUrl = null;
  } else if (input.imageDataUri) {
    const mimeType = validateDataUri(input.imageDataUri);
    if (!mimeType) {
      return { error: 'errors.invalidData' };
    }

    const base64Data = extractBase64(input.imageDataUri);
    if (!base64Data) {
      return { error: 'errors.invalidData' };
    }

    if (estimateBase64Size(base64Data) > MAX_LOGO_SIZE) {
      return { error: 'errors.invalidData' };
    }

    const extension = MIME_TO_EXT[mimeType] || 'jpg';
    const key = `users/${session.user.id}/avatar-${crypto.randomUUID().slice(0, 10)}.${extension}`;
    imageUrl = await uploadFile({
      key,
      body: Buffer.from(base64Data, 'base64'),
      contentType: mimeType,
    });
  }

  await db
    .update(users)
    .set({
      name: parsed.data.name,
      businessType: parsed.data.businessType,
      ...(imageUrl !== undefined ? { image: imageUrl } : {}),
      // Keep the first completion date if the user re-submits the step
      profileCompletedAt: sql`COALESCE(${users.profileCompletedAt}, NOW())`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.user.id));

  await captureProductServerEvent({
    distinctId: session.user.id,
    event: productAnalyticsEvents.onboardingProfileCompleted,
    properties: {
      business_type: parsed.data.businessType,
      avatar_action:
        imageUrl === undefined ? 'kept' : imageUrl ? 'uploaded' : 'removed',
      $set: {
        ...(parsed.data.businessType
          ? { business_type: parsed.data.businessType }
          : {}),
      },
    },
  });

  return { success: true as const, imageUrl };
}

export async function saveAcquisitionChannel(input: AcquisitionInput) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: 'errors.unauthorized' };
  }

  const parsed = acquisitionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: 'errors.invalidData' };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  });
  if (!user) {
    return { error: 'errors.unauthorized' };
  }

  // Never overwrite an existing answer ('invitation', a previous reply, …)
  if (user.acquisitionChannel) {
    return { success: true as const };
  }

  const other =
    parsed.data.channel === 'other' ? parsed.data.other?.trim() || null : null;

  await db
    .update(users)
    .set({
      acquisitionChannel: parsed.data.channel,
      acquisitionChannelOther: other,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.user.id));

  if (parsed.data.channel !== 'skipped') {
    await captureProductServerEvent({
      distinctId: session.user.id,
      event: productAnalyticsEvents.acquisitionChannelReported,
      properties: {
        acquisition_channel: parsed.data.channel,
        acquisition_channel_other: other,
        $set: {
          acquisition_channel: parsed.data.channel,
        },
      },
    });
  }

  return { success: true as const };
}
