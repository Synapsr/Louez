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
import { readApprovalPage } from "@louez/api/services/approval-page";
import { Button } from "@louez/ui";

import { HandoffCard } from "@/components/handoffs/handoff-card";
import { OperationApproval } from "@/components/handoffs/operation-approval";
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
 * that posts to `decide`, and so is an agent's request a person must
 * approve (an operation's approval), shown as Louez stored its preview. Each
 * form posts the revision the page showed, and what it showed of the step
 * (an invitation's `invitationShown`, an approval's binding): a step that
 * changed since decides nothing, and the page shows it again with a note.
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
  const query = await searchParams;
  const changed = query.changed !== undefined ? t("refused.changed.description") : null;
  // An operation's approval: decided here while pending, read from its row
  // (`readApprovalPage`); once out of the person's hands, its result says
  // where it stands. Anyone else gets what they get for any step.
  if (checked.row?.kind === "operation_approval") {
    const read = await readApprovalPage(checked.row.id, userId);
    if (!read.ok) {
      return (
        <HandoffCard
          title={t(`refused.${read.reason}.title`)}
          description={t(`refused.${read.reason}.description`)}
        />
      );
    }
    const { approval } = read;
    if (approval.state === "unreadable") {
      return (
        <HandoffCard
          title={t("operation_approval.unreadable.title")}
          description={t("operation_approval.unreadable.description")}
        />
      );
    }
    const { preview, binding } = approval;
    if (approval.state !== "pending" || !preview || !binding) {
      redirect(handoffDonePath(approval.id));
    }
    return (
      <OperationApproval
        action={`${path}/decide`}
        approval={{ ...approval, preview, binding }}
        email={session.user?.email ?? ""}
        note={
          changed ?? (query.error !== undefined ? t("operation_approval.error.failed") : null)
        }
      />
    );
  }
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
  const payload = invitationPayloadOf(checked.row);
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
