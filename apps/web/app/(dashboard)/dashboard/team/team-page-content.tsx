"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { TeamInvitationsCard } from "@/app/(dashboard)/dashboard/team/team-invitations-card";
import { TeamInviteCard } from "@/app/(dashboard)/dashboard/team/team-invite-card";
import { TeamMembersCard } from "@/app/(dashboard)/dashboard/team/team-members-card";
import type {
  TeamInvitation,
  TeamLimits,
  TeamMember,
} from "@/app/(dashboard)/dashboard/team/team-types";

interface TeamPageContentProps {
  members: TeamMember[];
  invitations: TeamInvitation[];
  limits: TeamLimits | null;
  canManageMembers: boolean;
  readOnly?: boolean;
  onInvite?: (email: string) => void | Promise<void>;
}

export const TeamPageContent = ({
  members,
  invitations,
  limits,
  canManageMembers,
  readOnly = false,
  onInvite,
}: TeamPageContentProps) => {
  const t = useTranslations("dashboard.team");

  return (
    <div className="mx-auto max-w-4xl space-y-4 sm:space-y-6">
      <div className="min-w-0 space-y-1">
        <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{t("title")}</h1>
        <p className="text-muted-foreground text-sm sm:text-base">{t("description")}</p>
      </div>

      {canManageMembers && (
        <TeamInviteCard limits={limits} readOnly={readOnly} onInvite={onInvite} />
      )}

      <TeamInvitationsCard
        invitations={invitations}
        canManageMembers={canManageMembers}
        readOnly={readOnly}
      />

      <TeamMembersCard members={members} canManageMembers={canManageMembers} readOnly={readOnly} />
      {canManageMembers && (
        <p className="text-muted-foreground text-sm">
          {t("googleAccessReminder")}{" "}
          <Link
            href="/online-store/seo"
            prefetch={readOnly ? false : undefined}
            onClick={readOnly ? (event) => event.preventDefault() : undefined}
            className="underline underline-offset-4"
          >
            {t("reviewGoogleAccess")}
          </Link>
        </p>
      )}
    </div>
  );
};
