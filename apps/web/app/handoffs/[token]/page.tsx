import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import {
  handoffDonePath,
  handoffPath,
  invitationPayloadOf,
  invitationShown,
  readHandoffLink,
} from "@louez/api/services/handoffs";
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
 * The page of a step only the user can take, as an agent's link names it:
 * `/handoffs/<id>`, or an older link's id then its secret. Signed out, they
 * sign in first. The page itself changes nothing: a link preview that loads
 * it starts no step. The user continues with a form that posts to
 * `continue`, which sends them to the provider; a team invitation is
 * approved or refused, with the owner's words if they add any, with a form
 * that posts to `decide`. Each form posts
 * the revision the page showed, and an invitation's form what it showed of
 * it (`invitationShown`): a step that changed since decides nothing, and the
 * page shows it again with a note.
 */
export default async function HandoffPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ retry?: string; error?: string; changed?: string }>;
}) {
  const { token } = await params;
  const path = handoffPath(token);
  const session = await auth();
  const userId = session?.user?.id;
  // The login keeps the link in a cookie, never in its own URL.
  if (!userId) redirect(`${path}/sign-in`);

  const t = await getTranslations("handoff");
  const checked = await readHandoffLink(token, userId);
  // A step that ended: its result says how, and why.
  if (!checked.ok && checked.reason === "finished" && checked.row) {
    redirect(handoffDonePath(checked.row.id));
  }
  if (!checked.ok) {
    return (
      <HandoffCard
        title={t(`refused.${checked.reason}.title`)}
        description={t(`refused.${checked.reason}.description`)}
      />
    );
  }

  const { kind, revision } = checked.row;
  // An operation's approval is decided on its page from pull request 4 of the
  // plan; until then its approver, and only them, reads that it is not available.
  if (kind === "operation_approval") {
    return (
      <HandoffCard
        title={t("operation_approval.unavailable.title")}
        description={t("operation_approval.unavailable.description")}
      />
    );
  }
  const payload = invitationPayloadOf(checked.row);
  const query = await searchParams;
  const changed = query.changed !== undefined ? t("refused.changed.description") : null;
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
        revision={revision}
        shown={invitationShown(payload)}
        store={checked.store.name}
        invitation={payload}
        note={changed ?? (query.error !== undefined ? t("team_invitation.error.failed") : null)}
      />
    );
  }

  return (
    <HandoffCard
      title={t(`kinds.${kind}.title`)}
      description={t(`kinds.${kind}.description`, { store: checked.store.name })}
      note={changed ?? (query.retry ? t("retry") : null)}
    >
      <form method="post" action={`${path}/continue`}>
        <input type="hidden" name="revision" value={revision} />
        <Button type="submit" className="w-full sm:w-auto">
          {t(`kinds.${kind}.continue`)}
        </Button>
      </form>
    </HandoffCard>
  );
}
