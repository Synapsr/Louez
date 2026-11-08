import {
  checkSlugAvailabilityInput,
  checkSlugAvailabilityOutput,
  createStoreInput,
  createStoreOutput,
  listStoresInput,
  listStoresOutput,
  storeErrors,
  STORE_CREATION_DAILY_LIMIT,
  STORE_PAGE_MAX,
} from "../../contracts/stores";
import { ACCOUNT_SCOPE, connectionStores } from "../../platform/actor";
import { requireConfirmation } from "../../platform/confirmation";
import { storeLinks } from "../../platform/links";
import { accountRefusal } from "../../platform/permissions";
import { accountProcedure, missingTransport } from "../../platform/procedures";
import {
  assertInstanceTakesAStore,
  assertSlugFree,
  assertUnderCreationLimit,
  checkStoreSlug,
  createStore,
  describeNewStoreTerms,
  resolvePendingReferral,
} from "../../services/store-creation";

/** May this connection add a store (`stores` write over all the user's stores)? */
const CREATE_SCOPE = { domain: "stores", level: "write" } as const;

/**
 * The stores the connection may act on, with the user's role in each: every
 * membership for a session, an API key's store, a grant's stores. An agent
 * whose connection covers several stores calls it first, then passes the
 * store's id as `storeId`.
 */
const list = accountProcedure
  .meta({
    capability: "stores.list",
    account: true,
    mcp: {
      name: "stores_list",
      description:
        "List the stores this connection may act on, with your role in each and its `links`: the store's dashboard and, once it is online, its storefront. Give the user those URLs when they ask where to see their store. When the connection covers several stores, pass the store's id as storeId to the other tools. With no store yet, the answer is empty and its `hint` says how to create one.",
      bundle: "daily",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
  })
  .route({ method: "GET", path: "/stores" })
  .input(listStoresInput)
  .output(listStoresOutput)
  .handler(async ({ context, input }) => {
    const { ports } = context;
    if (!ports) throw missingTransport();
    // Ordered by name, then id; a connection reaches few stores, so the page
    // is cut from the whole list.
    const all = await connectionStores(context.actor);
    const limit = input.limit ?? STORE_PAGE_MAX;
    let start = 0;
    if (input.cursor) {
      const index = all.findIndex((store) => store.id === input.cursor);
      if (index === -1) throw storeErrors.invalidCursor();
      start = index + 1;
    }
    const page = all.slice(start, start + limit);
    const items = page.map((store) => ({
      id: store.id,
      name: store.name,
      slug: store.slug,
      role: store.role === "owner" ? ("owner" as const) : ("member" as const),
      links: storeLinks(ports.urls, store),
    }));
    const last = page[page.length - 1];
    const mayCreate = accountRefusal(context.actor.credential, CREATE_SCOPE) === null;
    return {
      items,
      nextCursor: start + limit < all.length && last ? last.id : null,
      ...(all.length === 0
        ? {
            hint: mayCreate
              ? "No store yet. Create one with stores_create, after checking its web address with stores_check_slug_availability."
              : "This connection reaches no store. The user can create one in Louez.",
          }
        : {}),
    };
  });

/** Whether a store could take a web address now, with free ones close to it. */
const checkSlugAvailability = accountProcedure
  .meta({
    capability: "stores.checkSlugAvailability",
    account: true,
    mcp: {
      name: "stores_check_slug_availability",
      description:
        "Check whether a new store can take a web address (its slug) before stores_create. Answers `available`, the `reason` when it cannot (taken, reserved, invalid), and up to three free `suggestions` close to it. A name works too: the suggestions come from it.",
      bundle: "daily",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
  })
  .route({ method: "GET", path: "/stores/slug-availability" })
  .input(checkSlugAvailabilityInput)
  .output(checkSlugAvailabilityOutput)
  .handler(({ input }) => checkStoreSlug(input));

/** What an agent can do once the store exists: only tools that exist today. */
const NEXT_STEPS = [
  "Pass the store's id as storeId to the other tools.",
  "Fill the catalog: categories_create, then products_create (prices, deposit, stock). Their tools are in the catalog bundle.",
  "Set the store up before launch, with the tools of the settings bundle: settings_get shows every setting; settings_update_store_info (description, contact, coordinates), settings_update_legal (terms and legal notice), settings_update_reservation_rules, settings_update_business_hours, settings_update_delivery and settings_create_location (pickup points), settings_update_taxes.",
  "The store stays offline until the user launches it: they finish in the Louez dashboard (the dashboard link), where their store is waiting with what you filled in.",
];

/**
 * Creates a store owned by the caller: the onboarding's store step, and an
 * agent's "start my rental business". The store starts offline.
 */
const create = accountProcedure
  .meta({
    capability: "stores.create",
    account: true,
    scope: CREATE_SCOPE,
    sensitive: "money",
    mcp: {
      name: "stores_create",
      description: `Create a new rental store owned by the user, offline until they launch it. Check the web address first with stores_check_slug_availability. The store starts a billing relationship with Louez, so the first call answers CONFIRMATION_REQUIRED with a preview (name, address, the future public URL, country, currency and the pricing that applies): show it to the user, and once they agree, call again with the same arguments and the confirmationToken. Pass an idempotencyKey: a retry with it never creates a second store. Needs a connection with "Read and edit" rights on all the user's stores; ${STORE_CREATION_DAILY_LIMIT} stores per account a day at most. Returns the store's id (storeId for the other tools), its dashboard link and the next steps.`,
      bundle: "daily",
      annotations: { idempotentHint: true, openWorldHint: false },
    },
  })
  .route({ method: "POST", path: "/stores" })
  .input(createStoreInput)
  .output(createStoreOutput)
  .handler(async ({ context, input, path }) => {
    const { ports } = context;
    if (!ports) throw missingTransport();
    const { actor } = context;
    const { credential } = actor;

    // A dashboard request carries how the user arrived (cookies); an agent's
    // carries nothing, so its store is attributed to no one.
    const attribution =
      credential.kind === "session"
        ? ports.newStores.signupAttribution(context.headers)
        : { referralCode: null, signupOrigin: null };
    const referral = await resolvePendingReferral({
      userId: credential.userId,
      referralCode: attribution.referralCode,
    });

    await assertInstanceTakesAStore(ports.newStores.singleStore());
    await assertUnderCreationLimit(actor);
    await assertSlugFree(input.slug);

    // The preview's terms: the creation reads them again under its lock.
    const pricing = describeNewStoreTerms(
      await ports.newStores.previewTerms({
        currency: input.currency,
        referred: referral.attribution !== null,
      }),
    );
    const futureStorefrontUrl = ports.urls.storefront(input.slug, "/");
    await requireConfirmation({
      actor: { ...actor, storeId: ACCOUNT_SCOPE },
      headers: context.headers,
      procedure: path.join("."),
      input,
      state: { pricing, futureStorefrontUrl },
      preview: {
        summary: `Create the store "${input.name}" at ${futureStorefrontUrl}, offline until the user launches it. It starts a billing relationship with Louez: ${pricing.summary}`,
        details: {
          name: input.name,
          slug: input.slug,
          futureStorefrontUrl,
          country: input.country,
          currency: input.currency,
          owner: credential.email,
          pricing,
        },
      },
    });

    const created = await createStore({
      actor,
      store: input,
      referral,
      signupOrigin: attribution.signupOrigin,
      subscribe: ports.newStores.subscribe,
      welcomeCredits: ports.newStores.welcomeCredits(),
      // A caller that saw a preview confirmed its terms; one that runs
      // directly (a session, confirmation off) gets the terms in force.
      confirmedPricing: credential.confirmSensitive ? pricing : null,
    });
    ports.dispatchEffects(created.effectIds);

    return {
      id: created.id,
      name: created.name,
      slug: created.slug,
      country: created.country,
      currency: created.currency,
      timezone: created.timezone,
      online: false,
      links: storeLinks(ports.urls, { ...created, onboardingCompleted: false }),
      futureStorefrontUrl,
      pricing: created.pricing,
      nextSteps: NEXT_STEPS,
    };
  });

export const dashboardStoresRouter = { list, checkSlugAvailability, create };
