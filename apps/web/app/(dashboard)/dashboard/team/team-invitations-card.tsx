"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";
import { ClockSolidIcon } from "@louez/ui/icons";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";

import { TeamInvitationRow } from "./team-invitation-row";
import type { TeamInvitation } from "./team-types";

interface TeamInvitationsCardProps {
  invitations: TeamInvitation[];
  canManageMembers: boolean;
  readOnly?: boolean;
}

export const TeamInvitationsCard = ({
  invitations,
  canManageMembers,
  readOnly = false,
}: TeamInvitationsCardProps) => {
  const t = useTranslations("dashboard.team");

  if (invitations.length === 0) {
    return null;
  }

  return (
    <DashboardSectionCard
      title={t("pendingInvitations")}
      description={t("pendingInvitationsDescription")}
      icon={ClockSolidIcon}
      accent="pending"
      action={
        <Badge variant="expired" className="tabular-nums">
          {invitations.length}
        </Badge>
      }
      contentClassName="space-y-2"
    >
      {invitations.map((invitation) => (
        <TeamInvitationRow
          key={invitation.id}
          invitation={invitation}
          canManageMembers={canManageMembers}
          readOnly={readOnly}
        />
      ))}
    </DashboardSectionCard>
  );
};
