import {
  getLaunchChecklistInput,
  goLiveInput,
  goLiveOutput,
  launchChecklistOutput,
} from "../../contracts/launch";
import {
  checkSlugAvailabilityInput,
  checkSlugAvailabilityOutput,
  createStoreInput,
  createStoreOutput,
  listStoresInput,
  listStoresOutput,
  NO_STORE_ASK_USER,
  storeErrors,
  STORE_CREATION_DAILY_LIMIT,
  STORE_PAGE_MAX,
  SLUG_SUGGESTION_COUNT,
  updateOnboardingInfoInput,
  updateOnboardingInfoOutput,
} from "../../contracts/stores";
import type { BaseContext } from "../../context";
import { ACCOUNT_SCOPE, activeStoreIdOf, connectionStores } from "../../platform/actor";
import { requireConfirmation } from "../../platform/confirmation";
import { storeLinks } from "../../platform/links";
import { accountRefusal, type ProcedureScope } from "../../platform/permissions";
import { accountProcedure, missingTransport, storeProcedure } from "../../platform/procedures";
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
  .route({
    method: "GET",
    path: "/stores",
    description: `Lists the stores the key reaches, by name. An API key is bound to one store, so the list holds that store alone. Each store has its \`id\`, \`name\` and \`slug\`, the \`role\` in it of the user the key belongs to (\`owner\` or \`member\`), and \`links\`: \`links.dashboard\`, its page in the Louez dashboard, and once the store is online, \`links.storefront\`, its online store. \`limit\` (${STORE_PAGE_MAX} by default and at most) and \`cursor\` page the list; \`nextCursor\` is null on the last page.`,
  })
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
    const { credential } = context.actor;
    const mayCreate = accountRefusal(credential, CREATE_SCOPE) === null;
    // An agent whose directory forbids creating stores (ChatGPT) asks the user.
    const createdByUser = credential.withheld?.domains.includes("stores") === true;
    return {
      items,
      nextCursor: start + limit < all.length && last ? last.id : null,
      ...(all.length === 0
        ? {
            hint: createdByUser
              ? NO_STORE_ASK_USER
              : mayCreate
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
  .route({
    method: "GET",
    path: "/stores/slug-availability",
    description: `Checks whether a new store could take a web address (its slug: 3 to 50 lowercase letters, digits and hyphens). Answers \`available\` and, when it cannot, the \`reason\` (\`taken\`, \`reserved\` or \`invalid\`) with up to ${SLUG_SUGGESTION_COUNT} free \`suggestions\` close to it. A name works too in \`slug\`: the suggestions come from it. A store is created with \`POST /stores\`, which no API key can call; to change the address of the key's own store, check it with \`GET /online-store/slug-availability\`.`,
  })
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
      description: `Create a new rental store owned by the user, offline until they launch it. The store starts a billing relationship with Louez, so the first call answers CONFIRMATION_REQUIRED with a preview (name, address, the future public URL, country, currency and the pricing that applies). With an idempotency key, a retry never creates a second store. Available to an assistant connected over MCP with "Read and edit" rights on all of the user's stores; an API key is bound to its store and is answered 403 CONNECTION_BOUND_TO_STORES. ${STORE_CREATION_DAILY_LIMIT} stores per account a day at most. Returns the store's id (storeId for the other tools), its dashboard link and the next steps.`,
      bundle: "daily",
      effect: "additive",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "POST",
    path: "/stores",
    description:
      "Creates a store. No API key can call it: an API key is bound to its store and is answered 403 CONNECTION_BOUND_TO_STORES. A new store is created in the Louez dashboard.",
  })
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
      // Account-scoped, it stays at the caller's level: no store member to approve it.
      consequences: ["change"],
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
  .route({
    method: "GET",
    path: "/stores/launch-checklist",
    description: [
      "Returns what the store still lacks before customers can book, and whether it is `online`. Each entry of `items` has a `status`:",
      "",
      "- `done`: in place.",
      "- `missing`: customers will miss it; a `required` one stops `POST /stores/go-live`.",
      "- `optional`: the store works well without it.",
      "- `blocked`: Louez billing stops new bookings; only a person fixes it, in the Louez dashboard.",
      "- `unverified`: in place, but Louez cannot read it to check it, such as the text of a legal notice of the store's own.",
      "",
      "Each item says why it matters, names the operations that fix it by `operationId` (none when only a person can) and has `links.dashboard`, the page where it is seen or fixed. `canGoLive` and `blocking` sum up the required items still missing. The answer also gives how customers book (`bookingMode`: without Stripe charges enabled, a store in payment mode takes requests), the online store's address (the future one while offline), what the law asks of the store in its country (`legalRequirements`, null where Louez knows no rule) and `warnings`, which never stop the launch. `milestones` (the first reservation, the first completed one) is null with a key that cannot read reservations.",
    ].join("\n"),
  })
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
  .route({
    method: "POST",
    path: "/stores/go-live",
    description:
      "Puts the store online: its online store opens to the public and customers can book. Refused with `STORE_NOT_READY` while a required item of `GET /stores/launch-checklist` is missing, each one in `details.blocking`. `reservationMode` sets how customers book: `payment` (they pay at checkout; without Stripe charges enabled, they send requests until then) or `request` (the store accepts or refuses each request); left out, the store keeps its choice. On a key that asks for confirmations, it asks for one first (412 `CONFIRMATION_REQUIRED`), with a preview of the public address, how customers book, what they will see, and what is still missing, to check or optional. A store already online is not launched again and answers with `launched: false`; with another `reservationMode`, only the booking mode changes, after the same confirmation. Returns the online store's address, the booking mode, the items still missing or optional (`remaining`), the `warnings`, and `links.dashboard` and `links.storefront`.",
  })
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
          // The store can be taken offline again.
          consequences: ["change"],
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
  updateOnboardingInfo,
  getLaunchChecklist: getLaunchChecklistProcedure,
  completeOnboarding,
};
