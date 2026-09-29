"use client";

import { useState } from "react";

import { TeamPageContent } from "@/app/(dashboard)/dashboard/team/team-page-content";
import { DashboardSceneFrame } from "@/components/landing-demos/dashboard-scene-frame";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { getDemoToday } from "@/lib/landing-demos/reservations";
import { addDemoTeamInvitation, createDemoTeam } from "@/lib/landing-demos/team";

export const TeamInviteScene = ({ period }: FeatureSceneProps) => {
  const [team] = useState(() => createDemoTeam(period));
  const [invitations, setInvitations] = useState(team.invitations);

  return (
    <DashboardSceneFrame page="team">
      <TeamPageContent
        members={team.members}
        invitations={invitations}
        limits={team.limits}
        canManageMembers
        readOnly
        onInvite={(email) =>
          setInvitations((current) => addDemoTeamInvitation(current, email, getDemoToday(period)))
        }
      />
    </DashboardSceneFrame>
  );
};
