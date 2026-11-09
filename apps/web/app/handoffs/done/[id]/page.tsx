import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import {
  handoffDonePath,
  isConfirming,
  readHandoffForUser,
  statusOf,
} from "@louez/api/services/handoffs";

import { HandoffCard } from "@/components/handoffs/handoff-card";
import { auth } from "@/lib/auth";
import { createLoginUrl } from "@/lib/utils/util.url";

import { env } from "@/env";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("handoff");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

/**
 * Where the user lands once back from the provider: the step is done and
 * they can go back to their agent, or it is not finished yet. Shown only to
 * the user the handoff is for.
 */
export default async function HandoffDonePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect(createLoginUrl(handoffDonePath(id), env.NEXT_PUBLIC_APP_URL));

  const t = await getTranslations("handoff");
  const checked = await readHandoffForUser(id, userId);
  if (!checked.ok) {
    return (
      <HandoffCard
        title={t(`refused.${checked.reason}.title`)}
        description={t(`refused.${checked.reason}.description`)}
      />
    );
  }

  const { row } = checked;
  const status = statusOf(row, new Date());
  const state =
    status === "completed"
      ? "completed"
      : status === "failed"
        ? "failed"
        : status === "expired"
          ? "expired"
          : // Back from Checkout with a card Stripe has not confirmed yet.
            isConfirming(row, status)
            ? "confirming"
            : "opened";
  return (
    <HandoffCard title={t(`done.${state}.title`)} description={t(`done.${state}.description`)} />
  );
}
