import { redirect } from "next/navigation";

import { eq } from "drizzle-orm";

import { db, users } from "@louez/db";
import { profileSchema } from "@louez/validations";

import { isReeentSignupOrigin } from "@/lib/acquisition/signup-origin";
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

  const [user, fromReeent] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: {
        name: true,
        image: true,
        businessType: true,
        productCategory: true,
        fleetSize: true,
        profileCompletedAt: true,
        reeentIntroAcknowledgedAt: true,
      },
    }),
    isReeentSignupOrigin(),
  ]);

  // Loueurs referred by reeent get the education step before the first question.
  // The database timestamp makes this a durable one-way gate across browsers.
  if (fromReeent && !user?.reeentIntroAcknowledgedAt && !user?.profileCompletedAt) {
    redirect("/onboarding/reeent");
  }

  // businessType is required on submit but may not be answered yet, so the
  // stored value is parsed as nullable to prefill the select without erroring.
  const businessTypeResult = profileSchema.shape.businessType
    .nullable()
    .safeParse(user?.businessType ?? null);
  const productCategoryResult = profileSchema.shape.productCategory.safeParse(
    user?.productCategory ?? null,
  );
  const fleetSizeResult = profileSchema.shape.fleetSize.safeParse(user?.fleetSize ?? null);
  const businessType = businessTypeResult.success ? businessTypeResult.data : null;
  const productCategory = productCategoryResult.success ? productCategoryResult.data : null;
  const fleetSize = fleetSizeResult.success ? fleetSizeResult.data : null;

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
