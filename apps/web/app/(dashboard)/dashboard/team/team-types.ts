export interface TeamMember {
  id: string;
  role: "owner" | "admin" | "member";
  createdAt: Date;
  user: {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
  };
}

export interface TeamInvitation {
  id: string;
  email: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface TeamLimits {
  allowed: boolean;
  current: number;
  /** `null` means unlimited, `0` means the plan has no collaborators at all. */
  limit: number | null;
}
