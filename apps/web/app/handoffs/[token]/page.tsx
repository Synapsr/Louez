import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { handoffPath, readHandoffLink } from "@louez/api/services/handoffs";
import { Button } from "@louez/ui";

import { HandoffCard } from "@/components/handoffs/handoff-card";
import { TeamInvitationApproval } from "@/components/handoffs/team-invitation-approval";
import { auth } from "@/lib/auth";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("handoff");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

/**
 * The link an agent gave the user for a step only they can take. Signed out,
 * they sign in first. The page itself changes nothing: a link preview that
 * loads it starts no step. The user continues with a form that posts to
 * `continue`, which sends them to the provider; a team invitation is
 * approved or declined with a form that posts to `decide`.
 */
export default async function HandoffPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ retry?: string; error?: string }>;
}) {
  const { token } = await params;
  const path = handoffPath(token);
  const session = await auth();
  const userId = session?.user?.id;
  // The login keeps the link in a cookie, never in its own URL.
  if (!userId) redirect(`${path}/sign-in`);

  const t = await getTranslations("handoff");
  const checked = await readHandoffLink(token, userId);
  if (!checked.ok) {
    return (
      <HandoffCard
        title={t(`refused.${checked.reason}.title`)}
        description={t(`refused.${checked.reason}.description`)}
      />
    );
  }

  const { kind, payload } = checked.row;
  const query = await searchParams;
  if (kind === "team_invitation") {
    if (!payload) {
      return (
        <HandoffCard
          title={t("refused.invalid.title")}
          description={t("refused.invalid.description")}
        />
      );
    }
    return (
      <TeamInvitationApproval
        action={`${path}/decide`}
        store={checked.store.name}
        invitation={payload}
        error={query.error === "changed" ? "changed" : query.error ? "failed" : null}
      />
    );
  }

  return (
    <HandoffCard
      title={t(`kinds.${kind}.title`)}
      description={t(`kinds.${kind}.description`, { store: checked.store.name })}
      note={query.retry ? t("retry") : null}
    >
      <form method="post" action={`${path}/continue`}>
        <Button type="submit" className="w-full sm:w-auto">
          {t(`kinds.${kind}.continue`)}
        </Button>
      </form>
    </HandoffCard>
  );
}
