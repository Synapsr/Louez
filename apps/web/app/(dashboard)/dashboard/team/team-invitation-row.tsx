"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";

import type { TeamInvitation } from "@louez/api/contracts/team";
import { Button, toastManager } from "@louez/ui";
import { MailIcon, SubmittedSolidIcon, XCircleSolidIcon } from "@louez/ui/icons";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import { orpcClient } from "@/lib/orpc/client";
import { orpc } from "@/lib/orpc/react";

interface TeamInvitationRowProps {
  invitation: TeamInvitation;
  canManageMembers: boolean;
  readOnly?: boolean;
}

export const TeamInvitationRow = ({ invitation, canManageMembers, readOnly = false }: TeamInvitationRowProps) => {
  const t = useTranslations("dashboard.team");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();

  const onError = () => toastManager.add({ title: tErrors("generic"), type: "error" });
  const resendMutation = useMutation(
    orpc.dashboard.team.resendInvitation.mutationOptions({
      onSuccess: async (result) => {
        router.refresh();
        if (result.invitationEmail === "queued") {
          toastManager.add({ title: t("invitationResent"), type: "success" });
          return;
        }
        // This instance sends no e-mail: the user shares the new link.
        const { url } = await orpcClient.dashboard.team.invitationLink({ id: invitation.id });
        const copied = await navigator.clipboard
          ?.writeText(url)
          .then(() => true)
          .catch(() => false);
        toastManager.add({ title: copied ? t("invitationLinkCopied") : url, type: "success" });
      },
      onError,
    }),
  );
  const cancelMutation = useMutation(
    orpc.dashboard.team.cancelInvitation.mutationOptions({
      onSuccess: () => {
        toastManager.add({ title: t("invitationCancelled"), type: "success" });
        router.refresh();
      },
      onError,
    }),
  );
  const isPending = resendMutation.isPending || cancelMutation.isPending;

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
            date: format.dateTime(new Date(invitation.invitedAt), {
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
            onClick={() => !readOnly && resendMutation.mutate({ id: invitation.id })}
          >
            <SubmittedSolidIcon />
            {t("resend")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="max-sm:flex-1"
            disabled={readOnly || isPending}
            onClick={() => !readOnly && cancelMutation.mutate({ id: invitation.id })}
          >
            <XCircleSolidIcon />
            {t("cancel")}
          </Button>
        </div>
      )}
    </div>
  );
};
