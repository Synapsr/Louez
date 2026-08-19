import { redirect } from "next/navigation";

import { eq } from "drizzle-orm";

import { db, users } from "@louez/db";
import {
  BUSINESS_TYPES,
  type BusinessType,
  FLEET_SIZES,
  type FleetSize,
  PRODUCT_CATEGORIES,
  type ProductCategory,
} from "@louez/validations";

import { hasSeenReeentIntro, isReeentSignupOrigin } from "@/lib/acquisition/signup-origin";
import { auth } from "@/lib/auth";

import { ProfileClientPage } from "./profile-client-page";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function OnboardingProfilePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const [user, fromReeent, introSeen] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    }),
    isReeentSignupOrigin(),
    hasSeenReeentIntro(),
  ]);

  // Loueurs referred by reeent get the education step before the first
  // question. The "seen" marker makes this a one-way gate instead of a loop.
  if (fromReeent && !introSeen && !user?.profileCompletedAt) {
    redirect("/onboarding/reeent");
  }

  const businessType =
    user?.businessType && (BUSINESS_TYPES as readonly string[]).includes(user.businessType)
      ? (user.businessType as BusinessType)
      : null;

  const productCategory =
    user?.productCategory &&
    (PRODUCT_CATEGORIES as readonly string[]).includes(user.productCategory)
      ? (user.productCategory as ProductCategory)
      : null;

  const fleetSize =
    user?.fleetSize && (FLEET_SIZES as readonly string[]).includes(user.fleetSize)
      ? (user.fleetSize as FleetSize)
      : null;

  return (
    <ProfileClientPage
      initialName={user?.name ?? ""}
      initialImage={user?.image ?? null}
      initialBusinessType={businessType}
      initialProductCategory={productCategory}
      initialFleetSize={fleetSize}
      avatarSeed={session.user.id}
      fromReeent={fromReeent}
    />
  );
}
