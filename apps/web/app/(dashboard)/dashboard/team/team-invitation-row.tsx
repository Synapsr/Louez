"use client";

import { useTransition } from "react";

import { useFormatter, useTranslations } from "next-intl";

import { Button, toastManager } from "@louez/ui";
import { MailIcon, SubmittedSolidIcon, XCircleSolidIcon } from "@louez/ui/icons";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";

import { cancelInvitation, resendInvitation } from "./actions";
import type { TeamInvitation } from "./team-types";

interface TeamInvitationRowProps {
  invitation: TeamInvitation;
  canManageMembers: boolean;
  readOnly?: boolean;
}

export const TeamInvitationRow = ({ invitation, canManageMembers, readOnly = false }: TeamInvitationRowProps) => {
  const t = useTranslations("dashboard.team");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const [isPending, startTransition] = useTransition();

  const runAction = (
    action: () => Promise<{ error?: string; invitationUrl?: string }>,
    successMessage: string,
  ) => {
    if (readOnly) return;
    startTransition(async () => {
      const result = await action();

      if (result.invitationUrl) {
        const copied = await navigator.clipboard
          ?.writeText(result.invitationUrl)
          .then(() => true)
          .catch(() => false);
        toastManager.add({
          title: copied ? t("invitationLinkCopied") : result.invitationUrl,
          type: "success",
        });
        return;
      }

      toastManager.add({
        title: result.error ? tErrors("generic") : successMessage,
        type: result.error ? "error" : "success",
      });
    });
  };

  return (
    <div data-demo-target="team-pending-invitation" className="bg-muted/40 flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:items-center sm:gap-4">
      <DashboardIconTile
        icon={MailIcon}
        accent="pending"
        className="border-badge-pending-foreground/30 bg-transparent border border-dashed"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{invitation.email}</p>
        <p className="text-muted-foreground text-sm">
          {t("invitedOn", {
            date: format.dateTime(new Date(invitation.createdAt), {
              day: "2-digit",
              month: "short",
              year: "numeric",
            }),
          })}
        </p>
      </div>
      {canManageMembers && (
        <div className="flex items-center gap-2 max-sm:w-full">
          <Button
            variant="outline"
            size="sm"
            className="max-sm:flex-1"
            disabled={readOnly || isPending}
            onClick={() => runAction(() => resendInvitation(invitation.id), t("invitationResent"))}
          >
            <SubmittedSolidIcon />
            {t("resend")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="max-sm:flex-1"
            disabled={readOnly || isPending}
            onClick={() =>
              runAction(() => cancelInvitation(invitation.id), t("invitationCancelled"))
            }
          >
            <XCircleSolidIcon />
            {t("cancel")}
          </Button>
        </div>
      )}
    </div>
  );
};
