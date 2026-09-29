import { redirect } from "next/navigation";

import { getCurrentStore, currentUserHasPermission } from "@/lib/store-context";
import { getTeamData } from "./actions";
import { TeamPageContent } from "./team-page-content";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function TeamPage() {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const canManageMembers = await currentUserHasPermission("manage_members");
  const { members, invitations, limits } = await getTeamData();

  return (
    <TeamPageContent
      members={members}
      invitations={invitations}
      limits={limits}
      canManageMembers={canManageMembers}
    />
  );
}
