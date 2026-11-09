import { stripHtml } from "@louez/utils";

/**
 * Stripe Connect, as Louez uses it: Standard connected accounts onboarded
 * through hosted Account Links. The app lends its configured Stripe client
 * (`ports.stripeConnect`); this adapter holds what Louez sends and reads.
 * Only the calls below are used, so a test passes a fake with the same shape.
 */
export interface StripeConnectClient {
  accounts: {
    create: (params: StripeAccountCreateParams) => Promise<{ id: string }>;
    retrieve: (id: string) => Promise<StripeAccountLike>;
    createLoginLink: (id: string) => Promise<{ url: string }>;
  };
  accountLinks: {
    create: (params: {
      account: string;
      refresh_url: string;
      return_url: string;
      type: "account_onboarding";
      collect: "eventually_due";
    }) => Promise<{ url: string }>;
  };
}

/** What Louez reads of a connected account. */
export interface StripeAccountLike {
  type?: string | null;
  country?: string | null;
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
  requirements?: {
    currently_due?: string[] | null;
    eventually_due?: string[] | null;
    past_due?: string[] | null;
  } | null;
}

export interface StripeAccountCreateParams {
  type: "standard";
  email: string;
  country: string;
  business_profile: {
    name: string;
    url?: string;
    mcc: string;
    product_description?: string;
    support_email: string;
    support_phone?: string;
    support_url?: string;
  };
  settings?: { payments: { statement_descriptor: string } };
  capabilities: { card_payments: { requested: true }; transfers: { requested: true } };
  metadata: Record<string, string>;
}

// MCC 7394: "Equipment, Tool, Furniture, and Appliance Rental and Leasing" —
// the closest generic industry code for a rental business. Prefilled on the
// connected account so the hosted KYC's Industry dropdown starts on it; the
// merchant can still pick a more specific vertical in the Stripe form.
export const RENTAL_MCC = "7394";

/**
 * Normalize a store name into a valid Stripe statement descriptor: what the
 * end customer sees on their card statement. Stripe requires 5–22 characters,
 * at least one letter, no `<>\'"*`. Returns undefined when the name can't
 * make a valid descriptor (better to let the merchant type one in the KYC).
 */
export function toStatementDescriptor(name: string): string | undefined {
  const normalized = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[<>\\'"*]/g, "")
    .replace(/[^\x20-\x7e]/g, "") // Stripe only accepts printable ASCII
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, 22)
    .trim();

  if (normalized.length < 5 || !/[a-zA-Z]/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

/**
 * Turn the store description (rich-text editor HTML) into the plain text
 * Stripe accepts as `business_profile.product_description`: Stripe rejects
 * the whole account creation when the value contains HTML tags. `&amp;` is
 * decoded so "Sono & Lumière" reads right in the KYC; `&lt;`/`&gt;` stay
 * encoded so decoding can never rebuild a tag.
 */
export function toProductDescription(html: string | null | undefined): string | undefined {
  const text = html ? stripHtml(html).replace(/&amp;/g, "&").slice(0, 500).trim() : "";
  return text || undefined;
}

/** What Louez knows of a store when it opens its connected account. */
export interface ConnectAccountStore {
  id: string;
  name: string;
  description: string | null;
  phone: string | null;
  /** Its storefront URL; Stripe only takes a public https one. */
  storefrontUrl: string;
}

/**
 * A Standard connected account: it is its own merchant of record, settles
 * payments on its own balance, and bears Stripe processing fees and dispute
 * liability. Payments are direct charges; the platform commission, if any, is
 * an application fee. The hosted onboarding shows the prefilled fields for
 * review and lets the merchant edit them.
 */
export function connectAccountParams(input: {
  store: ConnectAccountStore;
  email: string;
  country: string;
}): StripeAccountCreateParams {
  const { store, email, country } = input;
  const httpsUrl = store.storefrontUrl.startsWith("https://") ? store.storefrontUrl : undefined;
  const statementDescriptor = toStatementDescriptor(store.name);
  return {
    type: "standard",
    email,
    country,
    business_profile: {
      name: store.name,
      url: httpsUrl,
      mcc: RENTAL_MCC,
      product_description: toProductDescription(store.description),
      support_email: email,
      support_phone: store.phone?.trim() || undefined,
      support_url: httpsUrl,
    },
    settings: statementDescriptor
      ? { payments: { statement_descriptor: statementDescriptor } }
      : undefined,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: { platform: "louez", storeId: store.id, storeName: store.name },
  };
}

/** The account's state, as the dashboard and the agent read it. */
export interface ConnectAccountStatus {
  country: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirements: { currentlyDue: string[]; eventuallyDue: string[]; pastDue: string[] };
}

export function readAccountStatus(account: StripeAccountLike): ConnectAccountStatus {
  return {
    country: account.country ?? null,
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
    requirements: {
      currentlyDue: account.requirements?.currently_due ?? [],
      eventuallyDue: account.requirements?.eventually_due ?? [],
      pastDue: account.requirements?.past_due ?? [],
    },
  };
}

export async function getAccountStatus(
  client: StripeConnectClient,
  accountId: string,
): Promise<ConnectAccountStatus> {
  return readAccountStatus(await client.accounts.retrieve(accountId));
}

/** A hosted onboarding link: single use, short-lived, never stored. */
export async function createOnboardingLink(
  client: StripeConnectClient,
  accountId: string,
  urls: { returnUrl: string; refreshUrl: string },
): Promise<string> {
  const link = await client.accountLinks.create({
    account: accountId,
    refresh_url: urls.refreshUrl,
    return_url: urls.returnUrl,
    type: "account_onboarding",
    collect: "eventually_due",
  });
  return link.url;
}

/** Stripe's own dashboard: an Express account gets a one-click login link, a Standard one signs in there. */
export async function createDashboardUrl(
  client: StripeConnectClient,
  accountId: string,
): Promise<string> {
  const account = await client.accounts.retrieve(accountId);
  if (account.type === "express") {
    return (await client.accounts.createLoginLink(accountId)).url;
  }
  return "https://dashboard.stripe.com";
}
