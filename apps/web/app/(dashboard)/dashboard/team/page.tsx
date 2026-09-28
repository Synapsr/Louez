import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { getCurrentStore, currentUserHasPermission } from "@/lib/store-context";
import { getTeamData } from "./actions";
import { TeamInvitationsCard } from "./team-invitations-card";
import { TeamInviteCard } from "./team-invite-card";
import { TeamMembersCard } from "./team-members-card";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function TeamPage() {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const t = await getTranslations("dashboard.team");
  const canManageMembers = await currentUserHasPermission("manage_members");
  const { members, invitations, limits } = await getTeamData();

  return (
    <div className="mx-auto max-w-4xl space-y-4 sm:space-y-6">
      <div className="min-w-0 space-y-1">
        <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{t("title")}</h1>
        <p className="text-muted-foreground text-sm sm:text-base">{t("description")}</p>
      </div>

      {canManageMembers && <TeamInviteCard limits={limits} />}

      <TeamInvitationsCard invitations={invitations} canManageMembers={canManageMembers} />

      <TeamMembersCard members={members} canManageMembers={canManageMembers} />
      {canManageMembers && (
        <p className="text-muted-foreground text-sm">
          {t("googleAccessReminder")}{" "}
          <Link href="/online-store/seo" className="underline underline-offset-4">
            {t("reviewGoogleAccess")}
          </Link>
        </p>
      )}
    </div>
  );
}
