"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, users } from "@louez/db";
import { isOwnedImageUrl } from "@louez/validations";

import { auth } from "@/lib/auth";

const updateAccountInfoSchema = z.object({
  name: z.string().trim().min(2).max(255),
  // undefined = keep the current image, null = remove it, string = uploaded URL.
  imageUrl: z.string().url().nullable().optional(),
});

type UpdateAccountInfoInput = z.infer<typeof updateAccountInfoSchema>;

export async function updateAccountInfo(input: UpdateAccountInfoInput) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "errors.unauthorized" };
  }

  const parsed = updateAccountInfoSchema.safeParse(input);
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
      ...(imageUrl !== undefined ? { image: imageUrl } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.user.id));

  return { success: true as const, imageUrl };
}
