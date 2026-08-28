import type { AccountDeletionReason } from "@louez/auth/account-deletion";

export interface AccountDeletionStoreContext {
  id: string;
  name: string;
  otherMemberCount: number;
  legalRecordCount: number;
  businessDocumentCount: number;
}

export interface AccountDeletionExternalResources {
  storagePrefixes: string[];
  stripeAccountIds: string[];
  stripeCustomerIds: string[];
  stripeSubscriptionIds: string[];
  googleAuthTokens: string[];
  googleCalendarConnections: Array<{
    calendarId: string | null;
    accessTokenEncrypted: string | null;
    refreshTokenEncrypted: string | null;
    accessTokenExpiresAt: Date | null;
  }>;
  superPdpTokensEncrypted: string[];
  tulipProductIds: string[];
  phoneNumberBindings: Array<{
    id: string;
    providerNumberId: string | null;
  }>;
}

export interface AccountDeletionContext {
  user: {
    id: string;
    email: string;
  };
  memberOnlyStoreCount: number;
  stores: AccountDeletionStoreContext[];
  externalResources: AccountDeletionExternalResources;
}

export interface AccountDeletionPurgeOptions {
  beforePurge: () => Promise<void>;
  reason?: AccountDeletionReason;
}

export interface AccountDeletionRepository {
  getContext: (userId: string) => Promise<AccountDeletionContext | null>;
  purgeOwnedData: (
    context: AccountDeletionContext,
    options: AccountDeletionPurgeOptions,
  ) => Promise<{
    storesDeleted: number;
    legalRecordsRetained: number;
  }>;
}

export interface AccountDeletionExternalServices {
  cleanup: (context: AccountDeletionContext) => Promise<void>;
}

export type AccountDeletionPreview =
  | {
      status: "ready";
      email: string;
      stores: Array<{ id: string; name: string }>;
      membershipsToLeave: number;
      legalRecordsToRetain: number;
      businessDocumentsToDelete: number;
    }
  | {
      status: "blocked";
      reason: "shared-store";
      stores: Array<{
        id: string;
        name: string;
        otherMemberCount: number;
      }>;
    };

interface GetAccountDeletionPreviewInput {
  userId: string;
  repository: AccountDeletionRepository;
}

interface DeleteAccountDataInput extends GetAccountDeletionPreviewInput {
  externalServices: AccountDeletionExternalServices;
  reason?: AccountDeletionReason;
}

type SharedStoreBlock = Extract<AccountDeletionPreview, { status: "blocked" }>;

const getSharedStoreBlock = (context: AccountDeletionContext): SharedStoreBlock | null => {
  const sharedStores = context.stores.filter((store) => store.otherMemberCount > 0);
  if (sharedStores.length === 0) return null;

  return {
    status: "blocked",
    reason: "shared-store",
    stores: sharedStores.map((store) => ({
      id: store.id,
      name: store.name,
      otherMemberCount: store.otherMemberCount,
    })),
  };
};

export const getAccountDeletionPreview = async ({
  userId,
  repository,
}: GetAccountDeletionPreviewInput): Promise<AccountDeletionPreview> => {
  const context = await repository.getContext(userId);
  if (!context) {
    throw new Error("Account not found");
  }

  const sharedStoreBlock = getSharedStoreBlock(context);
  if (sharedStoreBlock) return sharedStoreBlock;

  return {
    status: "ready",
    email: context.user.email,
    stores: context.stores.map((store) => ({
      id: store.id,
      name: store.name,
    })),
    membershipsToLeave: context.memberOnlyStoreCount,
    legalRecordsToRetain: context.stores.reduce(
      (total, store) => total + store.legalRecordCount,
      0,
    ),
    businessDocumentsToDelete: context.stores.reduce(
      (total, store) => total + store.businessDocumentCount,
      0,
    ),
  };
};

export const deleteAccountData = async ({
  userId,
  repository,
  externalServices,
  reason,
}: DeleteAccountDataInput) => {
  const context = await repository.getContext(userId);
  if (!context) {
    throw new Error("Account not found");
  }

  const sharedStoreBlock = getSharedStoreBlock(context);
  if (sharedStoreBlock) return sharedStoreBlock;

  const result = await repository.purgeOwnedData(context, {
    beforePurge: () => externalServices.cleanup(context),
    reason,
  });

  return {
    status: "deleted" as const,
    ...result,
  };
};
