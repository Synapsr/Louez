import {
  getLaunchChecklistInput,
  goLiveInput,
  goLiveOutput,
  launchChecklistOutput,
} from "../../contracts/launch";
import {
  checkSlugAvailabilityInput,
  checkSlugAvailabilityOutput,
  createStoreByLinkOutput,
  createStoreInput,
  createStoreOutput,
  listStoresInput,
  listStoresOutput,
  storeErrors,
  STORE_CREATION_DAILY_LIMIT,
  STORE_PAGE_MAX,
  updateOnboardingInfoInput,
  updateOnboardingInfoOutput,
} from "../../contracts/stores";
import type { BaseContext } from "../../context";
import { ACCOUNT_SCOPE, activeStoreIdOf, connectionStores } from "../../platform/actor";
import { requireConfirmation } from "../../platform/confirmation";
import { storeLinks } from "../../platform/links";
import { accountRefusal, type ProcedureScope } from "../../platform/permissions";
import { accountProcedure, missingTransport, storeProcedure } from "../../platform/procedures";
import { issueAccountHandoff } from "../../services/handoffs";
import { getLaunchChecklist, goLive, type GoLivePreview } from "../../services/launch";
import {
  assertInstanceTakesAStore,
  assertSlugFree,
  assertUnderCreationLimit,
  checkStoreSlug,
  createStore,
  describeNewStoreTerms,
  resolvePendingReferral,
  saveOnboardingStoreInfo,
} from "../../services/store-creation";
import { confirmUnderLock, mayRead } from "./product-context";
import { settingsActor } from "./settings-context";

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
      title: "List Stores",
      description:
        "List the stores this connection may act on, with your role in each and its `links`: the store's dashboard and, once it is online, its storefront. When the connection covers several stores, a store's id is the storeId the other tools take. With no store yet, the answer is empty and its `hint` says how to create one.",
      bundle: "daily",
      annotations: { idempotentHint: true },
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
      title: "Check New Store Address",
      description:
        "Check whether a new store can take a web address (its slug) before stores_create. Answers `available`, the `reason` when it cannot (taken, reserved, invalid), and up to three free `suggestions` close to it. A name works too: the suggestions come from it.",
      bundle: "daily",
      annotations: { idempotentHint: true },
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
  "Set the store up before launch, with the tools of the settings bundle: settings_get shows every setting; settings_update_store_info (description, contact, coordinates), settings_update_legal (terms and legal notice), settings_update_reservation_rules, settings_update_business_hours, settings_update_delivery and settings_create_location (pickup points), settings_update_taxes; for the storefront, online_store_update_appearance with the logo and banner from online_store_upload_image (or online_store_create_image_upload), and online_store_update_slug to change its address.",
  "The store stays offline until it goes live. stores_get_launch_checklist says what is still missing, with the tool that fixes each item; once the user is happy, stores_go_live puts the store online (it shows a preview first). The user can also finish in the Louez dashboard (the dashboard link), where their store is waiting with what you filled in.",
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
      title: "Create Store",
      description: `Create a new rental store owned by the user, offline until they launch it. The store starts a billing relationship with Louez, so the first call answers CONFIRMATION_REQUIRED with a preview (name, address, the future public URL, country, currency and the pricing that applies). With an idempotencyKey, a retry never creates a second store. Needs a connection with "Read and edit" rights on all the user's stores; ${STORE_CREATION_DAILY_LIMIT} stores per account a day at most. Returns the store's id (storeId for the other tools), its dashboard link and the next steps.`,
      bundle: "daily",
      effect: "additive",
      annotations: { idempotentHint: true },
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
    // Its directory has the user create stores: its own stores_create gives a link.
    if (credential.agentDirectory === "openai") throw storeErrors.createdByLink();

    // A dashboard request carries how the user arrived (cookies); an agent's
    // carries nothing, so its store is attributed to no one.
    const attribution =
      credential.kind === "session"
        ? ports.newStores.signupAttribution(context.headers)
        : { referralCode: null, signupOrigin: null, affiliateReferral: null };
    const referral = await resolvePendingReferral({
      userId: credential.userId,
      referralCode: attribution.referralCode,
      affiliateReferral: attribution.affiliateReferral,
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
    // The dashboard's onboarding goes on with the new store.
    if (credential.kind === "session") {
      setCookies(
        context,
        ports.newStores.onboardingCookies({
          activeStoreId: created.id,
          spendReferral: attribution.referralCode !== null,
        }),
      );
    }

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

/** What an agent does once it handed the store's creation to the user. */
const BY_LINK_NEXT_STEPS = [
  "Give the user the url as it is: signed in to Louez, they create the store there, starting from what you proposed, and may change any of it. Nothing is created until they do.",
  "handoffs_get with handoff.id says where it stands; once completed, its storeId names the new store: pass it as storeId to the other tools to set the store up.",
  "A link that expired, or another proposal, comes from calling stores_create again: it replaces the link.",
];

/**
 * stores_create for ChatGPT and Codex (`meta.mcp.directory`): OpenAI's plugin
 * guidelines forbid a plugin to start a subscription or show plans, and a
 * store starts one with Louez. Nothing is created: the user gets a link to
 * the dashboard's own store creation, prefilled with what the agent sent
 * (`store_creation` handoff), and accepts Louez's terms there. The store they
 * create completes the handoff; a connection over all the user's stores (the
 * scope requires one, as stores.create does) reaches it at once. The answer
 * holds the link's secret: never stored, never replayed.
 */
const createByLink = accountProcedure
  .meta({
    capability: "stores.createByLink",
    account: true,
    scope: CREATE_SCOPE,
    secretOutput: true,
    mcp: {
      name: "stores_create",
      title: "Create Store",
      description:
        'Propose a new rental store to the user. Nothing is created here: the answer is a link (url) where the user, signed in to Louez, creates the store in the Louez dashboard, starting from what this call sends (name, web address, country, currency, address, contact), which they may change. Returns the url, to give the user as it is, and the handoff: handoffs_get takes its id, and once the user created the store its storeId names it. Calling it again replaces the link. Needs a connection with "Read and edit" rights on all the user\'s stores.',
      bundle: "daily",
      effect: "overwrite",
      directory: "openai",
    },
  })
  .input(createStoreInput)
  .output(createStoreByLinkOutput)
  .handler(async ({ context, input }) => {
    const { ports } = context;
    if (!ports) throw missingTransport();
    const { credential } = context.actor;
    if (credential.agentDirectory !== "openai") throw storeErrors.createdByLink();
    await assertInstanceTakesAStore(ports.newStores.singleStore());
    const link = await issueAccountHandoff(
      {
        userId: credential.userId,
        credentialKind: credential.kind,
        credentialId: credential.id,
        clientName: credential.clientName,
      },
      "store_creation",
      { store: input },
      { urls: ports.urls },
    );
    return { ...link, nextSteps: BY_LINK_NEXT_STEPS };
  });

/** Cookies of a dashboard answer: set on the RPC endpoint only, which has the answer's headers. */
function setCookies(context: Pick<BaseContext, "resHeaders">, values: readonly string[]) {
  for (const value of values) context.resHeaders?.append("set-cookie", value);
}

/**
 * The onboarding's store step on a store the user already has (an
 * incomplete one, one an agent created included, or the one being edited).
 * Answers `id: null` when there is none, and the step creates the store
 * with stores.create. Sets the saved store as the active one.
 */
const updateOnboardingInfo = accountProcedure
  .meta({
    capability: "stores.updateOnboardingInfo",
    account: true,
    scope: CREATE_SCOPE,
    actors: ["session"],
    mcp: {
      exclude:
        "the onboarding wizard's own step; agents set the same fields with settings_update_store_info, settings_update_company and online_store_update_slug",
    },
  })
  .input(updateOnboardingInfoInput)
  .output(updateOnboardingInfoOutput)
  .handler(async ({ context, input }) => {
    const { ports } = context;
    if (!ports) throw missingTransport();
    const { storeId, ...store } = input;
    const attribution = ports.newStores.signupAttribution(context.headers);
    const saved = await saveOnboardingStoreInfo({
      actor: context.actor,
      store,
      editingStoreId: storeId ?? null,
      activeStoreId: activeStoreIdOf(context.headers),
      referralCode: attribution.referralCode,
      affiliateReferral: attribution.affiliateReferral,
      rewardReferredStore: ports.newStores.rewardReferredStore,
    });
    ports.dispatchEffects(saved.effectIds);
    if (saved.id) {
      setCookies(
        context,
        ports.newStores.onboardingCookies({
          activeStoreId: saved.id,
          spendReferral: saved.spendReferral,
        }),
      );
    }
    return { id: saved.id, online: saved.online, ownerSaved: saved.ownerSaved };
  });

// --- Launch -------------------------------------------------------------------

const LAUNCH_READ: ProcedureScope = { domain: "settings", level: "read" };
/** Going live is the onboarding's last step, which only members who manage settings reach. */
const LAUNCH_WRITE: ProcedureScope = {
  domain: "settings",
  level: "write",
  role: "manage_settings",
};

/** What a store still lacks before customers can book, item by item. */
const getLaunchChecklistProcedure = storeProcedure
  .meta({
    capability: "stores.getLaunchChecklist",
    scope: LAUNCH_READ,
    mcp: {
      name: "stores_get_launch_checklist",
      title: "Get Launch Checklist",
      description:
        "What the store still lacks before customers can book, and whether it is online. Each item has a status: done; missing (customers will miss it; a `required` one stops stores_go_live); optional; blocked (Louez billing stops new bookings: only the user fixes it in Louez); unverified (in place, but Louez cannot read it, so only the user can check it, such as a legal notice's own text). `warnings` are for the user: what the law asks that is missing, and what to check. Each item says why it matters and lists the tools that fix it, or none when only the user can, from its dashboard link. Also says how customers book (payment or request; without Stripe a store takes requests) and the storefront's address.",
      bundle: "daily",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "GET", path: "/stores/launch-checklist" })
  .input(getLaunchChecklistInput)
  .output(launchChecklistOutput)
  .handler(({ context }) =>
    getLaunchChecklist(context.actor.storeId, {
      urls: context.ports.urls,
      // The first bookings show only to a caller who may read reservations.
      withMilestones: mayRead(context, "reservations"),
      hostedBy: context.ports.hostedBy?.() ?? null,
    }),
  );

/**
 * Puts the store online: the onboarding's last step, and an agent's "launch
 * my store". Refused while a required item is missing; a store already
 * online answers as it is.
 */
const completeOnboarding = storeProcedure
  .meta({
    capability: "stores.completeOnboarding",
    scope: LAUNCH_WRITE,
    sensitive: "money",
    mcp: {
      name: "stores_go_live",
      title: "Put Store Online",
      description:
        "Put the store online: its storefront opens to the public and customers can book. Refused with STORE_NOT_READY while a required item is missing. The first call answers CONFIRMATION_REQUIRED with a preview (the public URL, how customers book, what they will see, what is still missing or optional). reservationMode sets how customers book; without Stripe connected, payment mode takes requests until it is. A store already online is not launched again: the answer gives its URL. Returns the storefront's URL and the store's `links`, the URLs to give the user.",
      bundle: "daily",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "POST", path: "/stores/go-live" })
  .input(goLiveInput)
  .output(goLiveOutput)
  .handler(async ({ context, input, path }) => {
    const { ports, actor } = context;
    const result = await goLive(
      {
        ...settingsActor(context),
        userId: actor.credential.userId,
        transport: actor.transport,
        credential: actor.credential,
      },
      input,
      {
        urls: ports.urls,
        hostedBy: ports.hostedBy?.() ?? null,
        // The preview and its binding read the checklist under the store's lock.
        confirm: confirmUnderLock<GoLivePreview>(context, path, input, (preview) => ({
          state: {
            statuses: preview.statuses,
            legalStatuses: preview.legalStatuses,
            bookingMode: preview.bookingMode,
            storefrontUrl: preview.storefrontUrl,
          },
          details: {
            // First, so a client shows them before anything else.
            warnings: preview.warnings,
            storefrontUrl: preview.storefrontUrl,
            bookingMode: preview.bookingMode,
            customersWillSee: preview.customersWillSee,
            stillMissing: preview.stillMissing,
            toCheck: preview.toCheck,
            optional: preview.optional,
          },
        })),
      },
    );
    ports.dispatchEffects(result.effectIds);
    const { checklist } = result;
    return {
      storeId: actor.storeId,
      online: true as const,
      launched: result.launched,
      storefrontUrl: checklist.storefrontUrl,
      bookingMode: result.bookingMode,
      remaining: checklist.items.filter((entry) => entry.status !== "done"),
      warnings: checklist.warnings,
      links: checklist.links,
    };
  });

export const dashboardStoresRouter = {
  list,
  checkSlugAvailability,
  create,
  createByLink,
  updateOnboardingInfo,
  getLaunchChecklist: getLaunchChecklistProcedure,
  completeOnboarding,
};
