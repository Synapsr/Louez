"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";
import { TeamIcon } from "@louez/ui/icons";

import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";

import { TeamMemberRow } from "./team-member-row";
import type { TeamMember } from "./team-types";

interface TeamMembersCardProps {
  members: TeamMember[];
  canManageMembers: boolean;
  readOnly?: boolean;
}

export const TeamMembersCard = ({ members, canManageMembers, readOnly = false }: TeamMembersCardProps) => {
  const t = useTranslations("dashboard.team");

  return (
    <DashboardSectionCard
      title={t("members")}
      description={t("membersDescription")}
      icon={TeamIcon}
      accent="progress"
      action={
        <Badge variant="expired" className="tabular-nums">
          {members.length}
        </Badge>
      }
    >
      {members.length === 0 ? (
        <DashboardEmptyState icon={TeamIcon} description={t("noMembers")} />
      ) : (
        <div className="-mx-2 space-y-0.5 sm:-mx-3">
          {members.map((member) => (
            <TeamMemberRow key={member.id} member={member} canManageMembers={canManageMembers} readOnly={readOnly} />
          ))}
        </div>
      )}
    </DashboardSectionCard>
  );
};
