import { addDays, subDays } from "date-fns";

import type {
  TeamInvitation,
  TeamLimits,
  TeamMember,
} from "@/app/(dashboard)/dashboard/team/team-types";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { getDemoCustomer, getDemoToday } from "@/lib/landing-demos/reservations";

export const createDemoTeam = (
  period: RentalPeriodValue,
): { members: TeamMember[]; invitations: TeamInvitation[]; limits: TeamLimits } => {
  const today = getDemoToday(period);
  return {
    members: [0, 1].map((index) => {
      const customer = getDemoCustomer(index);
      return {
        id: `demo-member-${index}`,
        role: index === 0 ? "owner" : "member",
        createdAt: subDays(today, index === 0 ? 90 : 30),
        user: {
          id: `demo-team-user-${index}`,
          email: `${customer.firstName.toLowerCase()}@maisonduvelo.example`,
          name: `${customer.firstName} ${customer.lastName}`,
          image: null,
        },
      };
    }),
    invitations: [],
    limits: { allowed: true, current: 1, limit: null },
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
      status: "pending",
      createdAt: new Date(today),
      expiresAt: addDays(today, 7),
    },
    ...invitations,
  ];
};
