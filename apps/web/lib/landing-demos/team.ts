import { addDays, subDays } from "date-fns";

import type { MemberLimit, TeamInvitation, TeamMember } from "@louez/api/contracts/team";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { getDemoCustomer, getDemoToday } from "@/lib/landing-demos/reservations";

export const createDemoTeam = (
  period: RentalPeriodValue,
): { members: TeamMember[]; invitations: TeamInvitation[]; limits: MemberLimit } => {
  const today = getDemoToday(period);
  return {
    members: [0, 1].map((index) => {
      const customer = getDemoCustomer(index);
      return {
        id: `demo-member-${index}`,
        userId: `demo-team-user-${index}`,
        name: `${customer.firstName} ${customer.lastName}`,
        email: `${customer.firstName.toLowerCase()}@maisonduvelo.example`,
        imageUrl: null,
        role: index === 0 ? "owner" : "member",
        joinedAt: subDays(today, index === 0 ? 90 : 30),
      };
    }),
    invitations: [],
    limits: { canAddMember: true, current: 1, limit: null },
  };
};

/** Mirrors the product's pending invitation and seven-calendar-day validity. */
export const addDemoTeamInvitation = (
  invitations: TeamInvitation[],
  email: string,
  today: Date,
): TeamInvitation[] => {
  const normalizedEmail = email.toLowerCase().trim();
  if (invitations.some((invitation) => invitation.email === normalizedEmail)) return invitations;
  return [
    {
      id: `demo-invitation-${normalizedEmail}`,
      email: normalizedEmail,
      role: "member",
      invitedAt: new Date(today),
      expiresAt: addDays(today, 7),
      expired: false,
    },
    ...invitations,
  ];
};
