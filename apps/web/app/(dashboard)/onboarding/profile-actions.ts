"use server";

import { eq, sql } from "drizzle-orm";

import { db, users } from "@louez/db";
import {
  type AcquisitionInput,
  acquisitionSchema,
  isOwnedImageUrl,
  profileSchema,
} from "@louez/validations";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { captureProductServerEvent } from "@/lib/product-analytics/analytics";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";
const updateUserProfileSchema = profileSchema.extend({
  // undefined = keep the current image, null = remove it, string = uploaded URL.
  imageUrl: z.string().url().nullable().optional(),
});

type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;

export async function updateUserProfile(input: UpdateUserProfileInput) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "errors.unauthorized" };
  }

  const parsed = updateUserProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "errors.invalidData" };
  }

  const imageUrl = parsed.data.imageUrl;
  if (imageUrl && !isOwnedImageUrl(imageUrl, `users/${session.user.id}`)) {
    return { error: "errors.invalidData" };
  }

  await db
    .update(users)
    .set({
      name: parsed.data.name,
      businessType: parsed.data.businessType,
      productCategory: parsed.data.productCategory,
      fleetSize: parsed.data.fleetSize,
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
      product_category: parsed.data.productCategory,
      fleet_size: parsed.data.fleetSize,
      avatar_action: imageUrl === undefined ? "kept" : imageUrl ? "uploaded" : "removed",
      $set: {
        ...(parsed.data.businessType ? { business_type: parsed.data.businessType } : {}),
        ...(parsed.data.productCategory ? { product_category: parsed.data.productCategory } : {}),
        ...(parsed.data.fleetSize ? { fleet_size: parsed.data.fleetSize } : {}),
      },
    },
  });

  return { success: true as const, imageUrl };
}

export async function saveAcquisitionChannel(input: AcquisitionInput) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "errors.unauthorized" };
  }

  const parsed = acquisitionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "errors.invalidData" };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  });
  if (!user) {
    return { error: "errors.unauthorized" };
  }

  // Never overwrite an existing answer ('invitation', a previous reply, …)
  if (user.acquisitionChannel) {
    return { success: true as const };
  }

  const other = parsed.data.channel === "other" ? parsed.data.other?.trim() || null : null;

  await db
    .update(users)
    .set({
      acquisitionChannel: parsed.data.channel,
      acquisitionChannelOther: other,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.user.id));

  if (parsed.data.channel !== "skipped") {
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
  } else {
    // A dedicated event (rather than acquisition_channel_reported with
    // channel=skipped) keeps the channel breakdowns clean while still
    // closing the funnel for users who skip the question.
    await captureProductServerEvent({
      distinctId: session.user.id,
      event: productAnalyticsEvents.onboardingSourceSkipped,
      properties: {
        feature: "onboarding",
        surface: "dashboard",
      },
    });
  }

  return { success: true as const };
}
