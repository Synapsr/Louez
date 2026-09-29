import assert from "node:assert/strict";
import test from "node:test";

import { differenceInCalendarDays } from "date-fns";

import { createDemoPeriod } from "@/lib/landing-demos/fixtures";
import { getDemoToday } from "@/lib/landing-demos/reservations";
import { addDemoTeamInvitation, createDemoTeam } from "@/lib/landing-demos/team";

test("the team starts with the product's owner/member roles and an available invite form", () => {
  const period = createDemoPeriod();
  const team = createDemoTeam(period);
  assert.deepEqual(
    team.members.map((member) => member.role),
    ["owner", "member"],
  );
  assert.equal(
    team.limits.current,
    team.members.filter((member) => member.role === "member").length,
  );
  assert.equal(team.limits.allowed, true);
  assert.equal(team.limits.limit, null);
  assert.deepEqual(team.invitations, []);
  assert.ok(
    team.members.every(
      (member) => member.createdAt < getDemoToday(period) && member.user.image === null,
    ),
  );
});

test("a local invitation is normalized, pending, valid for seven days, and does not mutate fixtures", () => {
  const period = createDemoPeriod();
  const team = createDemoTeam(period);
  const today = getDemoToday(period);
  const invitations = addDemoTeamInvitation(team.invitations, " Lea.Dupont@Example.com ", today);
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0].email, "lea.dupont@example.com");
  assert.equal(invitations[0].status, "pending");
  assert.equal(invitations[0].createdAt.getTime(), today.getTime());
  assert.equal(differenceInCalendarDays(invitations[0].expiresAt, today), 7);
  assert.equal(team.invitations.length, 0);
  assert.equal(addDemoTeamInvitation(invitations, "LEA.DUPONT@example.com", today), invitations);
  const next = addDemoTeamInvitation(invitations, "luc@example.com", today);
  assert.equal(next.length, 2);
  assert.equal(new Set(next.map((invitation) => invitation.id)).size, 2);
  assert.equal(createDemoTeam(period).invitations.length, 0);
});
