import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import {
  handoffDonePath,
  handoffPath,
  isConfirming,
  readHandoffForUser,
  statusOf,
} from "@louez/api/services/handoffs";
import { readApprovalPage } from "@louez/api/services/approval-page";

import { HandoffCard } from "@/components/handoffs/handoff-card";
import { OperationApprovalDone } from "@/components/handoffs/operation-approval-done";
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
 * they can go back to their agent, or it is not finished yet; and where an
 * answered step stands (an invitation, an agent's request a person
 * approved or refused). Shown only to the user the handoff is for.
 */
export default async function HandoffDonePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect(createLoginUrl(handoffDonePath(id), env.NEXT_PUBLIC_APP_URL));

  const t = await getTranslations("handoff");
  const checked = await readHandoffForUser(id, userId);
  // An operation's approval, as its row says, even once its connection is
  // gone (`readApprovalPage`): a request still to answer is on its page.
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
    if (approval.state === "pending") redirect(handoffPath(approval.id));
    if (approval.state === "unreadable") {
      return (
        <HandoffCard
          title={t("operation_approval.unreadable.title")}
          description={t("operation_approval.unreadable.description")}
        />
      );
    }
    return <OperationApprovalDone approval={approval} state={approval.state} />;
  }
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
  if (row.kind === "team_invitation") {
    // An owner's answer to an agent's invitation: there is no provider.
    const answer =
      status === "failed"
        ? row.failureCode === "declined"
          ? "declined"
          : row.failureCode === "request_changed"
            ? "changed"
            : "failed"
        : status === "opened"
          ? "pending"
          : status;
    return (
      <HandoffCard
        title={t(`team_invitation.done.${answer}.title`)}
        description={t(`team_invitation.done.${answer}.description`)}
      />
    );
  }
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
