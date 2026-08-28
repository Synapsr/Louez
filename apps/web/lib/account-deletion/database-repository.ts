import "server-only";

import { createHmac } from "node:crypto";

import { db } from "@louez/db";
import * as schema from "@louez/db";
import type { Transaction } from "@louez/db";
import { and, count, eq, gt, inArray, ne, notInArray, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { env } from "@/env";

import type {
  AccountDeletionContext,
  AccountDeletionPurgeOptions,
  AccountDeletionRepository,
} from "./account-deletion";
import { encryptLegalArchivePayload, getLegalRetentionDate } from "./legal-archive";

const retainedPayAsYouGoStatuses = ["open", "paid", "void"] as const;

const unique = (values: Array<string | null>): string[] => [
  ...new Set(values.filter((value): value is string => Boolean(value))),
];

const toDateOnly = (value: Date): string => value.toISOString().slice(0, 10);

const countLegalRecords = async (storeId: string): Promise<number> => {
  const [platform, smsPurchases, aiPurchases] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.payAsYouGoInvoices)
      .where(
        and(
          eq(schema.payAsYouGoInvoices.storeId, storeId),
          inArray(schema.payAsYouGoInvoices.status, retainedPayAsYouGoStatuses),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.smsTopupTransactions)
      .where(
        and(
          eq(schema.smsTopupTransactions.storeId, storeId),
          eq(schema.smsTopupTransactions.status, "completed"),
          gt(schema.smsTopupTransactions.totalAmountCents, 0),
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.aiCreditTransactions)
      .where(
        and(
          eq(schema.aiCreditTransactions.storeId, storeId),
          eq(schema.aiCreditTransactions.status, "completed"),
          gt(schema.aiCreditTransactions.amountCents, 0),
        ),
      ),
  ]);

  return [platform, smsPurchases, aiPurchases].reduce(
    (total, rows) => total + (rows[0]?.value ?? 0),
    0,
  );
};

const countBusinessDocuments = async (storeId: string): Promise<number> => {
  const [issued, received] = await Promise.all([
    db.select({ value: count() }).from(schema.invoices).where(eq(schema.invoices.storeId, storeId)),
    db
      .select({ value: count() })
      .from(schema.receivedInvoices)
      .where(eq(schema.receivedInvoices.storeId, storeId)),
  ]);

  return (issued[0]?.value ?? 0) + (received[0]?.value ?? 0);
};

const getContext = async (userId: string): Promise<AccountDeletionContext | null> => {
  const userRows = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const user = userRows[0];
  if (!user) return null;

  const ownedStores = await db
    .select({
      id: schema.stores.id,
      name: schema.stores.name,
      stripeAccountId: schema.stores.stripeAccountId,
    })
    .from(schema.stores)
    .where(eq(schema.stores.userId, userId));
  const ownedStoreIds = ownedStores.map((store) => store.id);

  const memberOnlyRows = await db
    .select({ value: count() })
    .from(schema.storeMembers)
    .where(
      ownedStoreIds.length > 0
        ? and(
            eq(schema.storeMembers.userId, userId),
            notInArray(schema.storeMembers.storeId, ownedStoreIds),
          )
        : eq(schema.storeMembers.userId, userId),
    );

  const stores = await Promise.all(
    ownedStores.map(async (store) => {
      const otherMemberRows = await db
        .select({ value: count() })
        .from(schema.storeMembers)
        .where(
          and(eq(schema.storeMembers.storeId, store.id), ne(schema.storeMembers.userId, userId)),
        );

      return {
        id: store.id,
        name: store.name,
        otherMemberCount: otherMemberRows[0]?.value ?? 0,
        legalRecordCount: await countLegalRecords(store.id),
        businessDocumentCount: await countBusinessDocuments(store.id),
      };
    }),
  );

  const subscriptionRows =
    ownedStoreIds.length > 0
      ? await db
          .select({
            stripeCustomerId: schema.subscriptions.stripeCustomerId,
            stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId,
          })
          .from(schema.subscriptions)
          .where(inArray(schema.subscriptions.storeId, ownedStoreIds))
      : [];
  const platformInvoiceRows =
    ownedStoreIds.length > 0
      ? await db
          .select({ stripeCustomerId: schema.payAsYouGoInvoices.stripeCustomerId })
          .from(schema.payAsYouGoInvoices)
          .where(inArray(schema.payAsYouGoInvoices.storeId, ownedStoreIds))
      : [];
  const phoneNumberBindings =
    ownedStoreIds.length > 0
      ? await db
          .select({
            id: schema.storePhoneNumbers.id,
            providerNumberId: schema.storePhoneNumbers.providerNumberId,
          })
          .from(schema.storePhoneNumbers)
          .where(inArray(schema.storePhoneNumbers.storeId, ownedStoreIds))
      : [];
  const authAccountRows = await db
    .select({
      accessToken: schema.accounts.accessToken,
      refreshToken: schema.accounts.refreshToken,
    })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, "google")));
  const integrationRows =
    ownedStoreIds.length > 0
      ? await db
          .select({
            providerKey: schema.storeIntegrations.providerKey,
            calendarId: schema.storeCalendarIntegrations.calendarId,
            accessTokenEncrypted: schema.integrationCredentials.accessTokenEncrypted,
            refreshTokenEncrypted: schema.integrationCredentials.refreshTokenEncrypted,
            accessTokenExpiresAt: schema.integrationCredentials.expiresAt,
          })
          .from(schema.storeIntegrations)
          .leftJoin(
            schema.integrationCredentials,
            eq(schema.integrationCredentials.integrationId, schema.storeIntegrations.id),
          )
          .leftJoin(
            schema.storeCalendarIntegrations,
            eq(schema.storeCalendarIntegrations.integrationId, schema.storeIntegrations.id),
          )
          .where(inArray(schema.storeIntegrations.storeId, ownedStoreIds))
      : [];
  const tulipProductRows =
    ownedStoreIds.length > 0
      ? await db
          .select({ tulipProductId: schema.productsTulip.tulipProductId })
          .from(schema.productsTulip)
          .innerJoin(schema.products, eq(schema.products.id, schema.productsTulip.productId))
          .where(inArray(schema.products.storeId, ownedStoreIds))
      : [];

  return {
    user,
    memberOnlyStoreCount: memberOnlyRows[0]?.value ?? 0,
    stores,
    externalResources: {
      storagePrefixes: [...ownedStoreIds.map((storeId) => `${storeId}/`), `users/${userId}/`],
      stripeAccountIds: unique(ownedStores.map((store) => store.stripeAccountId)),
      stripeCustomerIds: unique([
        ...subscriptionRows.map((row) => row.stripeCustomerId),
        ...platformInvoiceRows.map((row) => row.stripeCustomerId),
      ]),
      stripeSubscriptionIds: unique(subscriptionRows.map((row) => row.stripeSubscriptionId)),
      googleAuthTokens: unique(
        authAccountRows.flatMap((row) => [row.refreshToken, row.accessToken]),
      ),
      googleCalendarConnections: integrationRows
        .filter((row) => row.providerKey === "google-calendar")
        .map((row) => ({
          calendarId: row.calendarId,
          accessTokenEncrypted: row.accessTokenEncrypted,
          refreshTokenEncrypted: row.refreshTokenEncrypted,
          accessTokenExpiresAt: row.accessTokenExpiresAt,
        })),
      superPdpTokensEncrypted: unique(
        integrationRows
          .filter((row) => row.providerKey === "superpdp")
          .flatMap((row) => [row.refreshTokenEncrypted, row.accessTokenEncrypted]),
      ),
      tulipProductIds: unique(tulipProductRows.map((row) => row.tulipProductId)),
      phoneNumberBindings,
    },
  };
};

interface LegalArchiveInput {
  sourceType: "platform_invoice";
  sourceKey: string;
  documentNumber: string | null;
  issuedAt: string;
  payload: unknown;
}

const archiveLegalRecords = async (
  transaction: Transaction,
  storeIds: string[],
): Promise<number> => {
  if (storeIds.length === 0) return 0;

  const [platformInvoices, smsPurchases, aiPurchases] = await Promise.all([
    transaction
      .select({
        id: schema.payAsYouGoInvoices.id,
        storeId: schema.payAsYouGoInvoices.storeId,
        billingMonth: schema.payAsYouGoInvoices.billingMonth,
        locationCount: schema.payAsYouGoInvoices.locationCount,
        grossAmountCents: schema.payAsYouGoInvoices.grossAmountCents,
        collectedAtSourceCents: schema.payAsYouGoInvoices.collectedAtSourceCents,
        invoicedAmountCents: schema.payAsYouGoInvoices.invoicedAmountCents,
        currency: schema.payAsYouGoInvoices.currency,
        status: schema.payAsYouGoInvoices.status,
        stripeInvoiceId: schema.payAsYouGoInvoices.stripeInvoiceId,
        createdAt: schema.payAsYouGoInvoices.createdAt,
        paidAt: schema.payAsYouGoInvoices.paidAt,
      })
      .from(schema.payAsYouGoInvoices)
      .where(
        and(
          inArray(schema.payAsYouGoInvoices.storeId, storeIds),
          inArray(schema.payAsYouGoInvoices.status, retainedPayAsYouGoStatuses),
        ),
      ),
    transaction
      .select({
        id: schema.smsTopupTransactions.id,
        storeId: schema.smsTopupTransactions.storeId,
        quantity: schema.smsTopupTransactions.quantity,
        unitPriceCents: schema.smsTopupTransactions.unitPriceCents,
        totalAmountCents: schema.smsTopupTransactions.totalAmountCents,
        currency: schema.smsTopupTransactions.currency,
        stripeSessionId: schema.smsTopupTransactions.stripeSessionId,
        stripePaymentIntentId: schema.smsTopupTransactions.stripePaymentIntentId,
        status: schema.smsTopupTransactions.status,
        createdAt: schema.smsTopupTransactions.createdAt,
        completedAt: schema.smsTopupTransactions.completedAt,
      })
      .from(schema.smsTopupTransactions)
      .where(
        and(
          inArray(schema.smsTopupTransactions.storeId, storeIds),
          eq(schema.smsTopupTransactions.status, "completed"),
          gt(schema.smsTopupTransactions.totalAmountCents, 0),
        ),
      ),
    transaction
      .select({
        id: schema.aiCreditTransactions.id,
        storeId: schema.aiCreditTransactions.storeId,
        type: schema.aiCreditTransactions.type,
        creditsMicro: schema.aiCreditTransactions.creditsMicro,
        amountCents: schema.aiCreditTransactions.amountCents,
        currency: schema.aiCreditTransactions.currency,
        stripeSessionId: schema.aiCreditTransactions.stripeSessionId,
        stripePaymentIntentId: schema.aiCreditTransactions.stripePaymentIntentId,
        stripeInvoiceId: schema.aiCreditTransactions.stripeInvoiceId,
        status: schema.aiCreditTransactions.status,
        createdAt: schema.aiCreditTransactions.createdAt,
        completedAt: schema.aiCreditTransactions.completedAt,
      })
      .from(schema.aiCreditTransactions)
      .where(
        and(
          inArray(schema.aiCreditTransactions.storeId, storeIds),
          eq(schema.aiCreditTransactions.status, "completed"),
          gt(schema.aiCreditTransactions.amountCents, 0),
        ),
      ),
  ]);

  const recordCount = platformInvoices.length + smsPurchases.length + aiPurchases.length;
  if (recordCount === 0) return 0;

  const encryptionKey = env.LEGAL_ARCHIVE_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error(
      "LEGAL_ARCHIVE_ENCRYPTION_KEY is required to delete an account with accounting records",
    );
  }

  const legalProfiles = await transaction
    .select({
      storeId: schema.storeLegalProfiles.storeId,
      legalName: schema.storeLegalProfiles.legalName,
      legalForm: schema.storeLegalProfiles.legalForm,
      companyNumber: schema.storeLegalProfiles.companyNumber,
      companyNumberScheme: schema.storeLegalProfiles.companyNumberScheme,
      siret: schema.storeLegalProfiles.siret,
      vatNumber: schema.storeLegalProfiles.vatNumber,
      rcsCity: schema.storeLegalProfiles.rcsCity,
      shareCapital: schema.storeLegalProfiles.shareCapital,
      registeredAddress: schema.storeLegalProfiles.registeredAddress,
      registeredAddressComplement: schema.storeLegalProfiles.registeredAddressComplement,
      registeredPostalCode: schema.storeLegalProfiles.registeredPostalCode,
      registeredCity: schema.storeLegalProfiles.registeredCity,
      country: schema.storeLegalProfiles.country,
      vatRegime: schema.storeLegalProfiles.vatRegime,
      hasVatOnDebits: schema.storeLegalProfiles.hasVatOnDebits,
    })
    .from(schema.storeLegalProfiles)
    .where(inArray(schema.storeLegalProfiles.storeId, storeIds));
  const legalProfileByStoreId = new Map(
    legalProfiles.map(({ storeId, ...profile }) => [storeId, profile]),
  );

  const platformInvoiceIds = platformInvoices.map((invoice) => invoice.id);
  const platformFeeRows =
    platformInvoiceIds.length > 0
      ? await transaction
          .select({
            invoiceId: schema.platformFees.invoiceId,
            amountCents: schema.platformFees.amountCents,
            amountReversedCents: schema.platformFees.amountReversedCents,
            currency: schema.platformFees.currency,
            source: schema.platformFees.source,
            status: schema.platformFees.status,
            billingMonth: schema.platformFees.billingMonth,
            monthlyIndex: schema.platformFees.monthlyIndex,
            stripePaymentIntentId: schema.platformFees.stripePaymentIntentId,
            stripeApplicationFeeId: schema.platformFees.stripeApplicationFeeId,
            createdAt: schema.platformFees.createdAt,
            billedAt: schema.platformFees.billedAt,
          })
          .from(schema.platformFees)
          .where(inArray(schema.platformFees.invoiceId, platformInvoiceIds))
      : [];

  const archiveInputs: LegalArchiveInput[] = [
    ...platformInvoices.map(({ id, storeId, ...invoice }) => ({
      sourceType: "platform_invoice" as const,
      sourceKey: `payg:${id}`,
      documentNumber: invoice.stripeInvoiceId,
      issuedAt: toDateOnly(invoice.paidAt ?? invoice.createdAt),
      payload: {
        invoice,
        customerLegalProfile: legalProfileByStoreId.get(storeId) ?? null,
        fees: platformFeeRows
          .filter((fee) => fee.invoiceId === id)
          .map((fee) => ({
            amountCents: fee.amountCents,
            amountReversedCents: fee.amountReversedCents,
            currency: fee.currency,
            source: fee.source,
            status: fee.status,
            billingMonth: fee.billingMonth,
            monthlyIndex: fee.monthlyIndex,
            stripePaymentIntentId: fee.stripePaymentIntentId,
            stripeApplicationFeeId: fee.stripeApplicationFeeId,
            createdAt: fee.createdAt,
            billedAt: fee.billedAt,
          })),
      },
    })),
    ...smsPurchases.map(({ id, storeId, ...purchase }) => ({
      sourceType: "platform_invoice" as const,
      sourceKey: `sms-topup:${id}`,
      documentNumber: purchase.stripePaymentIntentId ?? purchase.stripeSessionId,
      issuedAt: toDateOnly(purchase.completedAt ?? purchase.createdAt),
      payload: {
        purchase,
        customerLegalProfile: legalProfileByStoreId.get(storeId) ?? null,
      },
    })),
    ...aiPurchases.map(({ id, storeId, ...purchase }) => ({
      sourceType: "platform_invoice" as const,
      sourceKey: `ai-topup:${id}`,
      documentNumber:
        purchase.stripeInvoiceId ?? purchase.stripePaymentIntentId ?? purchase.stripeSessionId,
      issuedAt: toDateOnly(purchase.completedAt ?? purchase.createdAt),
      payload: {
        purchase,
        customerLegalProfile: legalProfileByStoreId.get(storeId) ?? null,
      },
    })),
  ];

  const retentionGroupId = nanoid();
  for (const archiveInput of archiveInputs) {
    const sourceRecordHash = createHmac("sha256", encryptionKey)
      .update(archiveInput.sourceKey)
      .digest("hex");

    await transaction.insert(schema.legalRetentionRecords).values({
      id: nanoid(),
      retentionGroupId,
      sourceType: archiveInput.sourceType,
      sourceRecordHash,
      documentNumber: archiveInput.documentNumber,
      issuedAt: archiveInput.issuedAt,
      retainUntil: getLegalRetentionDate(archiveInput.issuedAt, env.LEGAL_ARCHIVE_FISCAL_YEAR_END),
      encryptedPayload: encryptLegalArchivePayload(archiveInput.payload, encryptionKey),
    });
  }

  return archiveInputs.length;
};

const purgeOwnedData = async (
  context: AccountDeletionContext,
  { beforePurge, reason }: AccountDeletionPurgeOptions,
): Promise<{ storesDeleted: number; legalRecordsRetained: number }> => {
  return db.transaction(async (transaction) => {
    const currentStores = await transaction
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(eq(schema.stores.userId, context.user.id))
      .for("update");
    const storeIds = currentStores.map((store) => store.id);

    if (
      storeIds.length !== context.stores.length ||
      storeIds.some((storeId) => !context.stores.some((store) => store.id === storeId))
    ) {
      throw new Error("Account deletion context changed; please try again");
    }

    if (storeIds.length > 0) {
      const otherMemberRows = await transaction
        .select({ id: schema.storeMembers.id })
        .from(schema.storeMembers)
        .where(
          and(
            inArray(schema.storeMembers.storeId, storeIds),
            ne(schema.storeMembers.userId, context.user.id),
          ),
        )
        .for("update");
      if (otherMemberRows.length > 0) {
        throw new Error("Account deletion blocked by a shared store");
      }
    }

    await beforePurge();

    const legalRecordsRetained = await archiveLegalRecords(transaction, storeIds);

    const reservationRows =
      storeIds.length > 0
        ? await transaction
            .select({ id: schema.reservations.id })
            .from(schema.reservations)
            .where(inArray(schema.reservations.storeId, storeIds))
        : [];
    const reservationIds = reservationRows.map((row) => row.id);
    const customerRows =
      storeIds.length > 0
        ? await transaction
            .select({ id: schema.customers.id })
            .from(schema.customers)
            .where(inArray(schema.customers.storeId, storeIds))
        : [];
    const customerIds = customerRows.map((row) => row.id);
    const productRows =
      storeIds.length > 0
        ? await transaction
            .select({ id: schema.products.id })
            .from(schema.products)
            .where(inArray(schema.products.storeId, storeIds))
        : [];
    const productIds = productRows.map((row) => row.id);
    const reservationItemRows =
      reservationIds.length > 0
        ? await transaction
            .select({ id: schema.reservationItems.id })
            .from(schema.reservationItems)
            .where(inArray(schema.reservationItems.reservationId, reservationIds))
        : [];
    const reservationItemIds = reservationItemRows.map((row) => row.id);
    const productUnitRows =
      productIds.length > 0
        ? await transaction
            .select({ id: schema.productUnits.id })
            .from(schema.productUnits)
            .where(inArray(schema.productUnits.productId, productIds))
        : [];
    const productUnitIds = productUnitRows.map((row) => row.id);
    const seasonalRows =
      productIds.length > 0
        ? await transaction
            .select({ id: schema.productSeasonalPricing.id })
            .from(schema.productSeasonalPricing)
            .where(inArray(schema.productSeasonalPricing.productId, productIds))
        : [];
    const seasonalIds = seasonalRows.map((row) => row.id);
    const variantDefinitionRows =
      storeIds.length > 0
        ? await transaction
            .select({ id: schema.variantDefinitions.id })
            .from(schema.variantDefinitions)
            .where(inArray(schema.variantDefinitions.storeId, storeIds))
        : [];
    const variantDefinitionIds = variantDefinitionRows.map((row) => row.id);
    const integrationRows =
      storeIds.length > 0
        ? await transaction
            .select({ id: schema.storeIntegrations.id })
            .from(schema.storeIntegrations)
            .where(inArray(schema.storeIntegrations.storeId, storeIds))
        : [];
    const integrationIds = integrationRows.map((row) => row.id);
    const invoiceRows =
      storeIds.length > 0
        ? await transaction
            .select({ id: schema.invoices.id, documentId: schema.invoices.documentId })
            .from(schema.invoices)
            .where(inArray(schema.invoices.storeId, storeIds))
        : [];
    const invoiceIds = invoiceRows.map((row) => row.id);
    const receivedInvoiceRows =
      storeIds.length > 0
        ? await transaction
            .select({ documentId: schema.receivedInvoices.documentId })
            .from(schema.receivedInvoices)
            .where(inArray(schema.receivedInvoices.storeId, storeIds))
        : [];
    const reservationDocumentRows =
      reservationIds.length > 0
        ? await transaction
            .select({ id: schema.documents.id })
            .from(schema.documents)
            .where(inArray(schema.documents.reservationId, reservationIds))
        : [];
    const documentIds = unique([
      ...invoiceRows.map((row) => row.documentId),
      ...receivedInvoiceRows.map((row) => row.documentId),
      ...reservationDocumentRows.map((row) => row.id),
    ]);
    const inspectionRows =
      storeIds.length > 0
        ? await transaction
            .select({ id: schema.inspections.id })
            .from(schema.inspections)
            .where(inArray(schema.inspections.storeId, storeIds))
        : [];
    const inspectionIds = inspectionRows.map((row) => row.id);
    const inspectionItemRows =
      inspectionIds.length > 0
        ? await transaction
            .select({ id: schema.inspectionItems.id })
            .from(schema.inspectionItems)
            .where(inArray(schema.inspectionItems.inspectionId, inspectionIds))
        : [];
    const inspectionItemIds = inspectionItemRows.map((row) => row.id);
    const fieldValueRows =
      inspectionItemIds.length > 0
        ? await transaction
            .select({ id: schema.inspectionFieldValues.id })
            .from(schema.inspectionFieldValues)
            .where(inArray(schema.inspectionFieldValues.inspectionItemId, inspectionItemIds))
        : [];
    const fieldValueIds = fieldValueRows.map((row) => row.id);
    const inspectionTemplateRows =
      storeIds.length > 0
        ? await transaction
            .select({ id: schema.inspectionTemplates.id })
            .from(schema.inspectionTemplates)
            .where(inArray(schema.inspectionTemplates.storeId, storeIds))
        : [];
    const inspectionTemplateIds = inspectionTemplateRows.map((row) => row.id);
    const storeChatRows =
      storeIds.length > 0
        ? await transaction
            .select({ id: schema.aiChats.id })
            .from(schema.aiChats)
            .where(inArray(schema.aiChats.storeId, storeIds))
        : [];
    const userChatRows = await transaction
      .select({ id: schema.aiChats.id })
      .from(schema.aiChats)
      .where(eq(schema.aiChats.userId, context.user.id));
    const chatIds = unique([
      ...storeChatRows.map((row) => row.id),
      ...userChatRows.map((row) => row.id),
    ]);
    const advisorConversationRows =
      storeIds.length > 0
        ? await transaction
            .select({ id: schema.aiAdvisorConversations.id })
            .from(schema.aiAdvisorConversations)
            .where(inArray(schema.aiAdvisorConversations.storeId, storeIds))
        : [];
    const advisorConversationIds = advisorConversationRows.map((row) => row.id);

    if (storeIds.length > 0) {
      await transaction
        .delete(schema.referralRewards)
        .where(
          or(
            inArray(schema.referralRewards.referrerStoreId, storeIds),
            inArray(schema.referralRewards.referredStoreId, storeIds),
          ),
        );
      await transaction
        .update(schema.stores)
        .set({ referredByStoreId: null })
        .where(inArray(schema.stores.referredByStoreId, storeIds));
    }

    await transaction
      .update(schema.stores)
      .set({ referredByUserId: null })
      .where(eq(schema.stores.referredByUserId, context.user.id));
    await transaction
      .update(schema.storeMembers)
      .set({ addedBy: null })
      .where(eq(schema.storeMembers.addedBy, context.user.id));
    await transaction
      .update(schema.storeIntegrations)
      .set({ connectedByUserId: null })
      .where(eq(schema.storeIntegrations.connectedByUserId, context.user.id));
    await transaction
      .update(schema.productUnitDowntimes)
      .set({ createdByUserId: null })
      .where(eq(schema.productUnitDowntimes.createdByUserId, context.user.id));
    await transaction
      .update(schema.productUnitEvents)
      .set({ actorUserId: null })
      .where(eq(schema.productUnitEvents.actorUserId, context.user.id));
    await transaction
      .update(schema.inspections)
      .set({ performedById: null })
      .where(eq(schema.inspections.performedById, context.user.id));
    await transaction
      .update(schema.reservationActivity)
      .set({ userId: null })
      .where(eq(schema.reservationActivity.userId, context.user.id));
    await transaction
      .update(schema.referralRewards)
      .set({ referredUserId: null })
      .where(eq(schema.referralRewards.referredUserId, context.user.id));
    await transaction
      .delete(schema.storeInvitations)
      .where(eq(schema.storeInvitations.invitedBy, context.user.id));

    if (inspectionItemIds.length > 0) {
      await transaction
        .delete(schema.inspectionPhotos)
        .where(inArray(schema.inspectionPhotos.inspectionItemId, inspectionItemIds));
    }
    if (fieldValueIds.length > 0) {
      await transaction
        .delete(schema.inspectionPhotos)
        .where(inArray(schema.inspectionPhotos.fieldValueId, fieldValueIds));
    }
    if (inspectionItemIds.length > 0) {
      await transaction
        .delete(schema.inspectionFieldValues)
        .where(inArray(schema.inspectionFieldValues.inspectionItemId, inspectionItemIds));
      await transaction
        .delete(schema.inspectionItems)
        .where(inArray(schema.inspectionItems.id, inspectionItemIds));
    }
    if (invoiceIds.length > 0) {
      await transaction
        .delete(schema.invoicePayments)
        .where(inArray(schema.invoicePayments.invoiceId, invoiceIds));
    }
    if (reservationItemIds.length > 0) {
      await transaction
        .delete(schema.reservationItemUnits)
        .where(inArray(schema.reservationItemUnits.reservationItemId, reservationItemIds));
    }
    if (reservationIds.length > 0) {
      await transaction
        .delete(schema.reservationCalendarEvents)
        .where(inArray(schema.reservationCalendarEvents.reservationId, reservationIds));
    }
    if (chatIds.length > 0) {
      await transaction
        .delete(schema.aiChatMessages)
        .where(inArray(schema.aiChatMessages.chatId, chatIds));
    }
    if (advisorConversationIds.length > 0) {
      await transaction
        .delete(schema.aiAdvisorMessages)
        .where(inArray(schema.aiAdvisorMessages.conversationId, advisorConversationIds));
    }
    if (integrationIds.length > 0) {
      await transaction
        .delete(schema.integrationCredentials)
        .where(inArray(schema.integrationCredentials.integrationId, integrationIds));
      await transaction
        .delete(schema.storeCalendarIntegrations)
        .where(inArray(schema.storeCalendarIntegrations.integrationId, integrationIds));
      await transaction
        .delete(schema.storeTulipIntegrations)
        .where(inArray(schema.storeTulipIntegrations.integrationId, integrationIds));
      await transaction
        .delete(schema.storeSuperPdpIntegrations)
        .where(inArray(schema.storeSuperPdpIntegrations.integrationId, integrationIds));
      await transaction
        .delete(schema.reservationCalendarEvents)
        .where(inArray(schema.reservationCalendarEvents.integrationId, integrationIds));
    }
    if (productIds.length > 0) {
      await transaction
        .delete(schema.productAccessories)
        .where(
          or(
            inArray(schema.productAccessories.productId, productIds),
            inArray(schema.productAccessories.accessoryId, productIds),
          ),
        );
      await transaction
        .delete(schema.productCategories)
        .where(inArray(schema.productCategories.productId, productIds));
      await transaction
        .delete(schema.productPricingTiers)
        .where(inArray(schema.productPricingTiers.productId, productIds));
      await transaction
        .delete(schema.productsTulip)
        .where(inArray(schema.productsTulip.productId, productIds));
    }
    if (seasonalIds.length > 0) {
      await transaction
        .delete(schema.productSeasonalPricingTiers)
        .where(inArray(schema.productSeasonalPricingTiers.seasonalPricingId, seasonalIds));
    }
    if (variantDefinitionIds.length > 0) {
      await transaction
        .delete(schema.variantValues)
        .where(inArray(schema.variantValues.definitionId, variantDefinitionIds));
    }
    if (inspectionTemplateIds.length > 0) {
      await transaction
        .delete(schema.inspectionTemplateFields)
        .where(inArray(schema.inspectionTemplateFields.templateId, inspectionTemplateIds));
    }
    if (customerIds.length > 0) {
      await transaction
        .delete(schema.customerSessions)
        .where(inArray(schema.customerSessions.customerId, customerIds));
    }

    if (storeIds.length > 0) {
      await transaction.delete(schema.invoices).where(inArray(schema.invoices.storeId, storeIds));
      await transaction
        .delete(schema.receivedInvoices)
        .where(inArray(schema.receivedInvoices.storeId, storeIds));
      if (documentIds.length > 0) {
        await transaction.delete(schema.documents).where(inArray(schema.documents.id, documentIds));
      }
      await transaction
        .delete(schema.invoiceSequences)
        .where(inArray(schema.invoiceSequences.storeId, storeIds));
      await transaction
        .delete(schema.platformFees)
        .where(inArray(schema.platformFees.storeId, storeIds));
      await transaction
        .delete(schema.payAsYouGoInvoices)
        .where(inArray(schema.payAsYouGoInvoices.storeId, storeIds));
      if (reservationIds.length > 0) {
        await transaction
          .delete(schema.payments)
          .where(inArray(schema.payments.reservationId, reservationIds));
      }
      await transaction
        .delete(schema.paymentRequests)
        .where(inArray(schema.paymentRequests.storeId, storeIds));
      await transaction
        .delete(schema.reservationActivity)
        .where(
          reservationIds.length > 0
            ? inArray(schema.reservationActivity.reservationId, reservationIds)
            : eq(schema.reservationActivity.userId, context.user.id),
        );
      await transaction.delete(schema.emailLogs).where(inArray(schema.emailLogs.storeId, storeIds));
      await transaction.delete(schema.smsLogs).where(inArray(schema.smsLogs.storeId, storeIds));
      await transaction
        .delete(schema.discordLogs)
        .where(inArray(schema.discordLogs.storeId, storeIds));
      await transaction
        .delete(schema.reviewRequestLogs)
        .where(inArray(schema.reviewRequestLogs.storeId, storeIds));
      await transaction
        .delete(schema.reminderLogs)
        .where(inArray(schema.reminderLogs.storeId, storeIds));
      await transaction
        .delete(schema.inspections)
        .where(inArray(schema.inspections.storeId, storeIds));
      await transaction
        .delete(schema.reservationItems)
        .where(
          reservationIds.length > 0
            ? inArray(schema.reservationItems.reservationId, reservationIds)
            : eq(schema.reservationItems.id, ""),
        );
      await transaction
        .delete(schema.verificationCodes)
        .where(inArray(schema.verificationCodes.storeId, storeIds));
      await transaction
        .delete(schema.reservations)
        .where(inArray(schema.reservations.storeId, storeIds));
      await transaction.delete(schema.customers).where(inArray(schema.customers.storeId, storeIds));
      await transaction
        .delete(schema.productUnitEvents)
        .where(inArray(schema.productUnitEvents.storeId, storeIds));
      await transaction
        .delete(schema.productUnitDowntimes)
        .where(inArray(schema.productUnitDowntimes.storeId, storeIds));
      if (productUnitIds.length > 0) {
        await transaction
          .delete(schema.productUnits)
          .where(inArray(schema.productUnits.id, productUnitIds));
      }
      await transaction
        .delete(schema.productSeasonalPricing)
        .where(
          productIds.length > 0
            ? inArray(schema.productSeasonalPricing.productId, productIds)
            : eq(schema.productSeasonalPricing.id, ""),
        );
      await transaction
        .delete(schema.productStats)
        .where(inArray(schema.productStats.storeId, storeIds));
      await transaction
        .delete(schema.inspectionTemplates)
        .where(inArray(schema.inspectionTemplates.storeId, storeIds));
      await transaction.delete(schema.pageViews).where(inArray(schema.pageViews.storeId, storeIds));
      await transaction.delete(schema.products).where(inArray(schema.products.storeId, storeIds));
      await transaction
        .delete(schema.variantDefinitions)
        .where(inArray(schema.variantDefinitions.storeId, storeIds));
      await transaction
        .delete(schema.categories)
        .where(inArray(schema.categories.storeId, storeIds));
      await transaction
        .delete(schema.storefrontEvents)
        .where(inArray(schema.storefrontEvents.storeId, storeIds));
      await transaction
        .delete(schema.dailyStats)
        .where(inArray(schema.dailyStats.storeId, storeIds));
      await transaction
        .delete(schema.adminDigestLogs)
        .where(inArray(schema.adminDigestLogs.storeId, storeIds));
      await transaction
        .delete(schema.promoCodes)
        .where(inArray(schema.promoCodes.storeId, storeIds));
      await transaction
        .delete(schema.smsTopupTransactions)
        .where(inArray(schema.smsTopupTransactions.storeId, storeIds));
      await transaction
        .delete(schema.smsCredits)
        .where(inArray(schema.smsCredits.storeId, storeIds));
      await transaction
        .delete(schema.aiCreditDebits)
        .where(inArray(schema.aiCreditDebits.storeId, storeIds));
      await transaction
        .delete(schema.aiCreditTransactions)
        .where(inArray(schema.aiCreditTransactions.storeId, storeIds));
      await transaction.delete(schema.aiCredits).where(inArray(schema.aiCredits.storeId, storeIds));
      await transaction
        .delete(schema.aiAdvisorMessages)
        .where(inArray(schema.aiAdvisorMessages.storeId, storeIds));
      await transaction
        .delete(schema.aiAdvisorConversations)
        .where(inArray(schema.aiAdvisorConversations.storeId, storeIds));
      await transaction.delete(schema.aiChats).where(inArray(schema.aiChats.storeId, storeIds));
      await transaction.delete(schema.apiKeys).where(inArray(schema.apiKeys.storeId, storeIds));
      await transaction
        .delete(schema.pushSubscriptions)
        .where(inArray(schema.pushSubscriptions.storeId, storeIds));
      await transaction
        .delete(schema.storePhoneNumbers)
        .where(inArray(schema.storePhoneNumbers.storeId, storeIds));
      await transaction
        .delete(schema.storeIntegrations)
        .where(inArray(schema.storeIntegrations.storeId, storeIds));
      await transaction
        .delete(schema.storeLegalProfiles)
        .where(inArray(schema.storeLegalProfiles.storeId, storeIds));
      await transaction
        .delete(schema.storeLocations)
        .where(inArray(schema.storeLocations.storeId, storeIds));
      await transaction
        .delete(schema.storeInvitations)
        .where(inArray(schema.storeInvitations.storeId, storeIds));
      await transaction
        .delete(schema.storeMembers)
        .where(inArray(schema.storeMembers.storeId, storeIds));
      await transaction
        .delete(schema.subscriptions)
        .where(inArray(schema.subscriptions.storeId, storeIds));
      await transaction.delete(schema.stores).where(inArray(schema.stores.id, storeIds));
    }

    await transaction.delete(schema.apiKeys).where(eq(schema.apiKeys.userId, context.user.id));
    await transaction
      .delete(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, context.user.id));
    await transaction
      .delete(schema.storeMembers)
      .where(eq(schema.storeMembers.userId, context.user.id));
    await transaction.delete(schema.aiChats).where(eq(schema.aiChats.userId, context.user.id));
    await transaction.delete(schema.accounts).where(eq(schema.accounts.userId, context.user.id));
    await transaction.delete(schema.sessions).where(eq(schema.sessions.userId, context.user.id));
    await transaction
      .delete(schema.verification)
      .where(
        or(
          eq(schema.verification.identifier, context.user.email),
          eq(schema.verification.value, context.user.id),
        ),
      );
    await transaction.delete(schema.users).where(eq(schema.users.id, context.user.id));

    if (reason) {
      await transaction
        .insert(schema.accountDepartureReasonCounters)
        .values({ reason, count: 1 })
        .onDuplicateKeyUpdate({
          set: {
            count: sql`${schema.accountDepartureReasonCounters.count} + 1`,
          },
        });
    }

    return {
      storesDeleted: storeIds.length,
      legalRecordsRetained,
    };
  });
};

export const accountDeletionRepository: AccountDeletionRepository = {
  getContext,
  purgeOwnedData,
};
