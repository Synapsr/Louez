import { redirect } from "next/navigation";

import { serverApi } from "@/lib/api/server-api";
import { currentUserHasPermission, getCurrentStore } from "@/lib/store-context";

import { TeamPageContent } from "./team-page-content";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

type TeamApi = Awaited<ReturnType<typeof serverApi>>["team"];

export default async function TeamPage() {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const { team } = await serverApi();
  const [canManageMembers, members, invitations] = await Promise.all([
    currentUserHasPermission("manage_members"),
    readMembers(team),
    readInvitations(team),
  ]);

  return (
    <TeamPageContent
      members={members.items}
      invitations={invitations}
      limits={members.memberLimit}
      canManageMembers={canManageMembers}
    />
  );
}

/** Every member, page after page, with the plan's seats. */
async function readMembers(team: TeamApi) {
  const first = await team.listMembers({});
  const items = [...first.items];
  for (let cursor = first.nextCursor; cursor; ) {
    const page = await team.listMembers({ cursor });
    items.push(...page.items);
    cursor = page.nextCursor;
  }
  return { items, memberLimit: first.memberLimit };
}

/** Every pending invitation, page after page. */
async function readInvitations(team: TeamApi) {
  const first = await team.listInvitations({});
  const items = [...first.items];
  for (let cursor = first.nextCursor; cursor; ) {
    const page = await team.listInvitations({ cursor });
    items.push(...page.items);
    cursor = page.nextCursor;
  }
  return items;
}
