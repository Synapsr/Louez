/** The part of a better-auth account row the account page reads. */
interface LinkedAccount {
  providerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LinkedAccountsSummary {
  googleLinked: boolean;
  /** When the current password was set or last changed; null without one. */
  passwordSetAt: Date | null;
}

/**
 * An account that only ever signed in by e-mail code has no row at all: the
 * code needs none. Rows exist for Google (`google`) and for a password
 * (`credential`) — better-auth touches `updatedAt` when the password changes.
 */
export const summarizeLinkedAccounts = (
  accounts: readonly LinkedAccount[],
): LinkedAccountsSummary => {
  const credential = accounts.find((account) => account.providerId === "credential");

  return {
    googleLinked: accounts.some((account) => account.providerId === "google"),
    passwordSetAt: credential ? credential.updatedAt : null,
  };
};
