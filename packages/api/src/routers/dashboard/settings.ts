import {
  PLAIN_TEXT_HELP,
  SETTINGS_LIMITS,
  createLocationInput,
  getSettingsInput,
  getSettingsOutput,
  locationOutput,
  setLocationActiveInput,
  updateBusinessHoursInput,
  updateBusinessHoursOutput,
  updateCompanyInput,
  updateCompanyOutput,
  updateDeliveryInput,
  updateDeliveryOutput,
  updateLegalInput,
  updateLegalOutput,
  updateLocationInput,
  updateReservationRulesInput,
  updateReservationRulesOutput,
  updateStoreInfoInput,
  updateStoreInfoOutput,
  updateTaxesInput,
  updateTaxesOutput,
} from "../../contracts/settings";
import {
  getLegalProfileInput,
  getLegalProfileOutput,
  searchCompanyRegistryInput,
  searchCompanyRegistryOutput,
  upsertLegalProfileInput,
  upsertLegalProfileOutput,
} from "../../contracts/legal-profile";
import { onlineStoreLinks, settingsLinks, type SettingsPage } from "../../platform/links";
import type { ProcedureScope } from "../../platform/permissions";
import { storeProcedure } from "../../platform/procedures";
import {
  createLocation,
  getSettings,
  setLocationActive,
  updateBusinessHours,
  updateCompany,
  updateDelivery,
  updateLegal,
  updateLocation,
  updateReservationRules,
  updateStoreInfo,
  updateTaxes,
  type SettingsPreview,
} from "../../services/settings";
import {
  getLegalProfile,
  searchCompanyRegistry,
  upsertLegalProfile,
  type LegalProfilePreview,
} from "../../services/legal-profile";
import { confirmUnderLock, type ProductContext } from "./product-context";
import { settingsActor } from "./settings-context";

/**
 * The store settings, on every transport: the dashboard's settings pages
 * (RPC), `/api/v1/settings` (OpenAPI) and the `settings_*` MCP tools of the
 * settings bundle. The logic is in services/settings.ts; this file holds the
 * contract, the rights and the confirmations.
 */

const READ: ProcedureScope = { domain: "settings", level: "read" };
/** The dashboard lets only members who manage settings change them. */
const WRITE: ProcedureScope = { domain: "settings", level: "write", role: "manage_settings" };

const LINKS_HELP =
  "Its `links` hold the dashboard page of these settings and, once the store is online, its storefront, the URLs to give the user.";

const CONFIRM_HELP =
  "Customers see this change at checkout, so when it changes something the first call answers CONFIRMATION_REQUIRED with a preview of each value before and after.";

/** The REST reference's own texts (`.route({ description })`), for a developer. */
const REST_LINKS_NOTE =
  "`links.dashboard` is the page of these settings in the Louez dashboard; once the store is online, `links.storefront` is its storefront's home.";

const REST_SEND_ONLY =
  "Send only the fields to change; a request with none is refused with `NOTHING_TO_UPDATE`.";

const REST_CONFIRMS =
  "asks for a confirmation first (412 `CONFIRMATION_REQUIRED`) on a key that asks for confirmations, with each value before and after in the preview";

const REST_RICH_TEXT = `${PLAIN_TEXT_HELP} A text too long once saved as HTML is refused with \`TEXT_TOO_LONG\`, one nested too deep with \`TEXT_TOO_DEEP\`.`;

const links = (context: ProductContext, page: SettingsPage) =>
  settingsLinks(context.ports.urls, context.store, page);

/** The confirmation of a settings write, bound to each value it changes. */
const confirmChanges = (context: ProductContext, path: readonly string[], input: unknown) =>
  confirmUnderLock<SettingsPreview>(context, path, input, (preview) => ({
    // What customers see or pay from now on: the store can set it back.
    consequences: ["change"],
    state: preview.changes,
    details: { changes: preview.changes },
  }));

// --- Read --------------------------------------------------------------------

const get = storeProcedure
  .meta({
    capability: "settings.get",
    scope: READ,
    mcp: {
      name: "settings_get",
      title: "Get Store Settings",
      description: `Everything a store is set up with, in one call: its info and contact (store), company (country, time zone, currency, billing address), legal texts (whether the terms and the legal notice are set and their length; pass includeLegalTexts: true for the full texts, before editing them), the storefront (web address, URL, theme, logos, banner photos), reservation rules (booking mode, durations, notice, buffers, extensions), business hours and closures, delivery and pickup points (locations), taxes, and whether Stripe takes payments. Each section has its settings_update_* tool, which takes the field names shown here (the legal texts as cgv and legalNotice). ${LINKS_HELP}`,
      bundle: "settings",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "GET",
    path: "/settings",
    description: `Returns everything the store is set up with: its info and contact (\`store\`), the company (country, time zone, currency, billing address), the legal texts, the storefront (web address, URL, tagline, language, appearance), the reservation rules, the business hours and closures, delivery, the pickup points (\`locations\`), taxes, and whether Stripe takes payments. The terms and the legal notice come as a summary, whether each is set and its length; \`includeLegalTexts=true\` adds their full text, up to ${SETTINGS_LIMITS.richText.toLocaleString("en-US")} characters each. Each section is changed by its own \`PATCH /settings/…\` operation, which takes the field names shown here (the legal texts as \`cgv\` and \`legalNotice\`). ${REST_LINKS_NOTE} Each pickup point and the storefront come with their own \`links\`.`,
  })
  .input(getSettingsInput)
  .output(getSettingsOutput)
  .handler(async ({ context, input }) => {
    const { row: _row, ...settings } = await getSettings(context.actor.storeId, {
      includeLegalTexts: input.includeLegalTexts,
    });
    return {
      ...settings,
      locations: settings.locations.map((location) => ({
        ...location,
        links: links(context, "delivery"),
      })),
      storefront: {
        ...settings.storefront,
        url: context.ports.urls.storefront(settings.storefront.slug, "/"),
        links: onlineStoreLinks(context.ports.urls, context.store, "identity"),
      },
      links: links(context, "company"),
    };
  });

// --- Store info, company, legal ----------------------------------------------

const updateStoreInfoProcedure = storeProcedure
  .meta({
    capability: "settings.updateStoreInfo",
    scope: WRITE,
    mcp: {
      name: "settings_update_store_info",
      title: "Update Store Information",
      description: `Change the store's name, description and contact details (email, phone, address, coordinates), as the storefront shows them. Send only the fields to change; null clears one. Send latitude and longitude with a new address: delivery distances are measured from them. The description takes plain text (blank lines make paragraphs) or simple HTML. ${PLAIN_TEXT_HELP} Returns the store info. ${LINKS_HELP}`,
      bundle: "settings",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "PATCH",
    path: "/settings/store-info",
    description: `Changes the store's name, description and contact details (\`email\`, \`phone\`, \`address\`, \`latitude\`, \`longitude\`), as the storefront shows them. ${REST_SEND_ONLY} A null clears a field. Send \`latitude\` and \`longitude\` with a new address: delivery distances are measured from them. The description takes plain text (blank lines make paragraphs) or simple HTML, sanitised before it is saved. ${REST_RICH_TEXT} Returns the store info. \`links.dashboard\` is the identity page of the online store editor; once the store is online, \`links.storefront\` is its storefront's home.`,
  })
  .input(updateStoreInfoInput)
  .output(updateStoreInfoOutput)
  .handler(async ({ context, input }) => {
    const { store } = await updateStoreInfo(settingsActor(context), input);
    return {
      store,
      links: onlineStoreLinks(context.ports.urls, { ...context.store, ...store }, "identity"),
    };
  });

const updateCompanyProcedure = storeProcedure
  .meta({
    capability: "settings.updateCompany",
    scope: WRITE,
    sensitive: "money",
    mcp: {
      name: "settings_update_company",
      title: "Update Company Details",
      description: `Change the company's country (it sets the time zone), the currency of every price, and the billing address printed on contracts and invoices. Send only the fields to change. A new country or currency changes what customers see and pay: the first call answers CONFIRMATION_REQUIRED with a preview. Returns the company settings. ${LINKS_HELP}`,
      bundle: "settings",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "PATCH",
    path: "/settings/company",
    description: `Changes the company's country, the currency and the billing address printed on contracts and invoices. The country sets the store's time zone, which every date and opening hour follows. New reservations use the new currency for their prices, deposits and payments. A currency Louez does not take is refused with \`CURRENCY_NOT_SUPPORTED\`, unless it is the store's current one sent back unchanged. ${REST_SEND_ONLY} A new country or currency ${REST_CONFIRMS}; the billing address alone is saved directly. Returns the company settings. ${REST_LINKS_NOTE}`,
  })
  .input(updateCompanyInput)
  .output(updateCompanyOutput)
  .handler(async ({ context, input, path }) => ({
    company: await updateCompany(settingsActor(context), input, {
      confirm: confirmChanges(context, path, input),
    }),
    links: links(context, "company"),
  }));

const updateLegalProcedure = storeProcedure
  .meta({
    capability: "settings.updateLegal",
    scope: WRITE,
    mcp: {
      name: "settings_update_legal",
      title: "Update Legal Texts",
      description: `Change the store's legal texts: terms and conditions (cgv), legal notice, whether the full terms are printed in rental contracts, and the storefront's footer note. Send only the fields to change; null clears a text. Texts take plain text (blank lines make paragraphs) or simple HTML, ${SETTINGS_LIMITS.richText} characters at most. ${PLAIN_TEXT_HELP} Returns the legal texts, with the online store editor's legal page in \`links\`, the URL to give the user.`,
      bundle: "settings",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "PATCH",
    path: "/settings/legal",
    description: `Changes the store's legal texts: the terms and conditions (\`cgv\`), the legal notice (\`legalNotice\`), whether the full terms are printed in every rental contract (\`includeCgvInContract\`), and the plain-text note at the bottom of the storefront's footer (\`footerNote\`, 500 characters at most). ${REST_SEND_ONLY} A null or blank text clears it. The terms and the legal notice take plain text (blank lines make paragraphs) or simple HTML, ${SETTINGS_LIMITS.richText.toLocaleString("en-US")} characters at most, sanitised before they are saved. ${REST_RICH_TEXT} \`GET /settings?includeLegalTexts=true\` returns the current texts. Returns the legal texts as saved, in HTML. \`links.dashboard\` is the legal page of the online store editor; once the store is online, \`links.storefront\` is its storefront's home.`,
  })
  .input(updateLegalInput)
  .output(updateLegalOutput)
  .handler(async ({ context, input }) => ({
    legal: await updateLegal(settingsActor(context), input),
    links: onlineStoreLinks(context.ports.urls, context.store, "legal"),
  }));

// --- Reservation rules and hours ---------------------------------------------

const updateReservationRulesProcedure = storeProcedure
  .meta({
    capability: "settings.updateReservationRules",
    scope: WRITE,
    sensitive: "money",
    mcp: {
      name: "settings_update_reservation_rules",
      title: "Update Reservation Rules",
      description: `Change how customers book: the booking mode (payment online, or request the store accepts), the share paid online, the shortest and longest rental, the notice before a rental starts, the buffer after each return, whether checkout asks for an address, extensions, and whether the contract must be signed before pickup. Durations are in minutes. Send only the fields to change. Payment mode needs Stripe connected (STRIPE_REQUIRED otherwise). A change of the booking mode or of the share paid online is seen at checkout: the first call answers CONFIRMATION_REQUIRED with a preview. Returns the rules. ${LINKS_HELP}`,
      bundle: "settings",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "PATCH",
    path: "/settings/reservation-rules",
    description: `Changes how customers book: the booking mode (\`payment\`: paid online at checkout; \`request\`: a request the store accepts or declines), whether an unanswered request already holds the stock, the share paid online (10 to 100 percent), the shortest and longest rental, the notice before a rental starts, the buffer after each return (a week at most), whether checkout asks for the customer's address, extensions, and whether the contract must be signed before pickup (\`contractSignatureMode\`). Durations are in minutes, a year at most. ${REST_SEND_ONLY} Refused with \`SETTINGS_INVALID\` when the shortest rental would be longer than the longest, and with \`STRIPE_REQUIRED\` when switching to \`payment\` while the store's Stripe account does not take charges. A change of the booking mode or of the share paid online ${REST_CONFIRMS}. Returns the rules. ${REST_LINKS_NOTE}`,
  })
  .input(updateReservationRulesInput)
  .output(updateReservationRulesOutput)
  .handler(async ({ context, input, path }) => ({
    reservationRules: await updateReservationRules(settingsActor(context), input, {
      confirm: confirmChanges(context, path, input),
    }),
    links: links(context, "reservations"),
  }));

const updateBusinessHoursProcedure = storeProcedure
  .meta({
    capability: "settings.updateBusinessHours",
    scope: WRITE,
    mcp: {
      name: "settings_update_business_hours",
      title: "Update Business Hours",
      description: `Change the store's opening hours and closures: pickups and returns are only offered within them. Days are named (monday…sunday), each open or closed with up to 4 ranges (HH:mm, in the store's time zone); days left out stay as they are. closurePeriods replaces every closure, the current ones included (settings_get lists them). Returns the hours. ${LINKS_HELP}`,
      bundle: "settings",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "PATCH",
    path: "/settings/business-hours",
    description: `Changes the opening hours and closures; with \`enabled: true\`, pickups and returns are only offered within them, and with \`enabled: false\` the store takes bookings at any time. \`schedule\` names the days to change (\`monday\` … \`sunday\`), each with \`isOpen\` and up to ${SETTINGS_LIMITS.rangesPerDay} \`ranges\` of \`openTime\` and \`closeTime\` (HH:mm, in the store's time zone); days left out stay as they are. \`closurePeriods\` replaces every closure, ${SETTINGS_LIMITS.closurePeriods} at most: send the current ones, as \`GET /settings\` returns them with their \`id\`, along with your change to keep them. ${REST_SEND_ONLY} Returns the hours. ${REST_LINKS_NOTE}`,
  })
  .input(updateBusinessHoursInput)
  .output(updateBusinessHoursOutput)
  .handler(async ({ context, input }) => ({
    businessHours: await updateBusinessHours(settingsActor(context), input),
    links: links(context, "hours"),
  }));

// --- Delivery and pickup points ----------------------------------------------

const updateDeliveryProcedure = storeProcedure
  .meta({
    capability: "settings.updateDelivery",
    scope: WRITE,
    sensitive: "money",
    mcp: {
      name: "settings_update_delivery",
      title: "Update Delivery Settings",
      description: `Change delivery to the customer's address: on or off, its mode, the fee per kilometre and the lowest fee (decimal strings in the store's currency), the farthest distance, the order amount from which it is free, and whether customers may pick one of the store's pickup points. Send only the fields to change. Delivery needs the store's coordinates (STORE_COORDINATES_REQUIRED otherwise). ${CONFIRM_HELP} Returns the delivery settings. ${LINKS_HELP}`,
      bundle: "settings",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "PATCH",
    path: "/settings/delivery",
    description: `Changes delivery to the customer's address: on or off (\`enabled\`), its \`mode\` (\`optional\`: the customer chooses pickup or delivery; \`required\`: outbound delivery is mandatory; \`included\`: mandatory and free), the fee per kilometre, the lowest fee per leg, the farthest distance (\`maximumDistanceKm\`, 1 to 500, null for no limit), the order amount from which it is free, the smallest order delivered, and whether customers may choose one of the store's active pickup points (\`multiLocationEnabled\`). Amounts are decimal strings in the store's currency, such as \`"1.50"\`. ${REST_SEND_ONLY} Distances are measured from the store: while delivery is on, a store without coordinates is refused with \`STORE_COORDINATES_REQUIRED\` (\`PATCH /settings/store-info\` sets them). Any change ${REST_CONFIRMS}. Returns the delivery settings. ${REST_LINKS_NOTE}`,
  })
  .input(updateDeliveryInput)
  .output(updateDeliveryOutput)
  .handler(async ({ context, input, path }) => ({
    delivery: await updateDelivery(settingsActor(context), input, {
      confirm: confirmChanges(context, path, input),
    }),
    links: links(context, "delivery"),
  }));

const createLocationProcedure = storeProcedure
  .meta({
    capability: "settings.createLocation",
    scope: WRITE,
    mcp: {
      name: "settings_create_location",
      title: "Add Pickup Point",
      description: `Add a pickup and return point customers can choose at checkout (once the delivery settings allow pickup points): a name, an address, and its coordinates when you have them. A store has 50 at most. Returns the point, with its id for settings_update_location. ${LINKS_HELP} An idempotency key makes a retry safe.`,
      bundle: "settings",
      effect: "additive",
      reach: "public",
    },
  })
  .route({
    method: "POST",
    path: "/settings/locations",
    description: `Adds a pickup and return point: a \`name\`, an \`address\`, and optionally its city, postal code, country (the store's by default) and coordinates. Customers can choose it at checkout once \`multiLocationEnabled\` is on (\`PATCH /settings/delivery\`). A new point is active. A store has ${SETTINGS_LIMITS.locations} at most: one more is refused with \`LOCATION_LIMIT_REACHED\`. Returns the point with its \`id\`. ${REST_LINKS_NOTE}`,
  })
  .input(createLocationInput)
  .output(locationOutput)
  .handler(async ({ context, input }) => ({
    ...(await createLocation(settingsActor(context), input)),
    links: links(context, "delivery"),
  }));

const updateLocationProcedure = storeProcedure
  .meta({
    capability: "settings.updateLocation",
    scope: WRITE,
    mcp: {
      name: "settings_update_location",
      title: "Update Pickup Point",
      description: `Change a pickup point: send its id and only the fields to change; null clears one. Returns the point. ${LINKS_HELP}`,
      bundle: "settings",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "PATCH",
    path: "/settings/locations/{id}",
    description: `Changes a pickup point. ${REST_SEND_ONLY} A null clears an optional field (city, postal code, country, coordinates). An unknown id answers \`LOCATION_NOT_FOUND\`. Returns the point. ${REST_LINKS_NOTE}`,
  })
  .input(updateLocationInput)
  .output(locationOutput)
  .handler(async ({ context, input }) => ({
    ...(await updateLocation(settingsActor(context), input)),
    links: links(context, "delivery"),
  }));

const setLocationActiveProcedure = storeProcedure
  .meta({
    capability: "settings.setLocationActive",
    scope: WRITE,
    mcp: {
      name: "settings_set_location_active",
      title: "Turn Pickup Point On or Off",
      description: `Show (true) or hide (false) a pickup point at checkout. Reservations that already use it keep it. Returns the point. ${LINKS_HELP}`,
      bundle: "settings",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "POST",
    path: "/settings/locations/{id}/active",
    description: `Shows (\`isActive: true\`) or hides (\`false\`) a pickup point at checkout. Reservations that already use it keep it. An unknown id answers \`LOCATION_NOT_FOUND\`. Returns the point. ${REST_LINKS_NOTE}`,
  })
  .input(setLocationActiveInput)
  .output(locationOutput)
  .handler(async ({ context, input }) => ({
    ...(await setLocationActive(settingsActor(context), input)),
    links: links(context, "delivery"),
  }));

// --- Taxes -------------------------------------------------------------------

const updateTaxesProcedure = storeProcedure
  .meta({
    capability: "settings.updateTaxes",
    scope: WRITE,
    sensitive: "money",
    mcp: {
      name: "settings_update_taxes",
      title: "Update Taxes",
      description: `Change the store's taxes: on or off, the default rate in percent (20 for 20 %), whether prices include tax (inclusive, TTC) or have it added (exclusive, HT), the tax's label and the store's tax number. Send only the fields to change; null clears the label or the number. ${CONFIRM_HELP} Returns the taxes. ${LINKS_HELP}`,
      bundle: "settings",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "PATCH",
    path: "/settings/taxes",
    description: `Changes the store's taxes: on or off, the default rate in percent (0 to 100; 20 for 20 %), whether prices include tax (\`inclusive\`) or have it added (\`exclusive\`), the tax's label on documents (20 characters at most) and the store's tax number (30 at most). ${REST_SEND_ONLY} A null clears the label or the number. Any change ${REST_CONFIRMS}. Returns the taxes. ${REST_LINKS_NOTE}`,
  })
  .input(updateTaxesInput)
  .output(updateTaxesOutput)
  .handler(async ({ context, input, path }) => ({
    taxes: await updateTaxes(settingsActor(context), input, {
      confirm: confirmChanges(context, path, input),
    }),
    links: links(context, "taxes"),
  }));

// --- Legal identity ------------------------------------------------------------

const getLegalProfileProcedure = storeProcedure
  .meta({
    capability: "settings.getLegalProfile",
    scope: READ,
    mcp: {
      name: "settings_get_legal_profile",
      title: "Get Legal Profile",
      description: `The store's legal identity, as invoices, contracts and the legal notice name it: legal name, legal form, company number (SIREN in France), SIRET, VAT number, trade register city, share capital, registered office, and the electronic invoicing switches. Null until the store saved one (settings_update_legal_profile). ${LINKS_HELP}`,
      bundle: "settings",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "GET",
    path: "/settings/legal-profile",
    description: `Returns the store's legal identity, as invoices, contracts and the legal notice name it: legal name and form, company number (the SIREN in France, the BCE number in Belgium), SIRET, VAT number, trade register city, share capital, registered office, and the electronic invoicing settings (\`invoicingEnabled\`, \`vatRegime\`, \`hasVatOnDebits\`). \`profile\` is null until the store saved one with \`PATCH /settings/legal-profile\`. ${REST_LINKS_NOTE}`,
  })
  .input(getLegalProfileInput)
  .output(getLegalProfileOutput)
  .handler(async ({ context }) => ({
    profile: await getLegalProfile(context.actor.storeId),
    links: links(context, "invoicing"),
  }));

const searchCompanyRegistryProcedure = storeProcedure
  .meta({
    capability: "settings.searchCompanyRegistry",
    scope: READ,
    mcp: {
      name: "settings_search_company_registry",
      title: "Search Company Registry",
      description:
        "Look a French company up in the public registry (recherche-entreprises.api.gouv.fr) by its name, SIREN or SIRET, to fill the store's legal identity without typing it. Returns up to 8 matches with their SIREN, SIRET, legal name, legal form, VAT number, registered office and whether the company is still active. A match maps onto settings_update_legal_profile: siren as companyNumber, address as registeredAddress, postalCode as registeredPostalCode, city as registeredCity. `available: false`: the registry did not answer.",
      bundle: "settings",
      reach: "provider",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "GET",
    path: "/settings/company-registry",
    description:
      "Looks a French company up in the public registry (recherche-entreprises.api.gouv.fr) by `query`: its name, SIREN or SIRET, 3 to 120 characters. Returns up to 8 matches, each with its SIREN, SIRET, legal name, legal form, VAT number, registered office, trade register city and whether it is still active. A match maps onto `PATCH /settings/legal-profile`: `siren` as `companyNumber`, `address` as `registeredAddress`, `addressComplement` as `registeredAddressComplement`, `postalCode` as `registeredPostalCode`, `city` as `registeredCity`; the other fields keep their names. `available: false` means the registry did not answer, and `results` is empty.",
  })
  .input(searchCompanyRegistryInput)
  .output(searchCompanyRegistryOutput)
  .handler(({ input }) => searchCompanyRegistry(input.query));

const upsertLegalProfileProcedure = storeProcedure
  .meta({
    capability: "settings.upsertLegalProfile",
    scope: WRITE,
    sensitive: "money",
    mcp: {
      name: "settings_update_legal_profile",
      title: "Update Legal Profile",
      description: `Save the store's legal identity: legal name, legal form, company number (the SIREN in France, 9 digits), SIRET, VAT number, trade register city, share capital and registered office. A first save needs legalName, legalForm, companyNumber, registeredAddress, registeredPostalCode and registeredCity (country defaults to the store's); later, send only the fields to change, and null clears an optional one. Turning electronic invoicing on or off, or changing the VAT regime, changes how the store's invoices reach the tax network: that call answers CONFIRMATION_REQUIRED with a preview. The identity alone saves directly. Returns the profile. ${LINKS_HELP}`,
      bundle: "settings",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "PATCH",
    path: "/settings/legal-profile",
    description: `Saves the store's legal identity: legal name and form, company number (the SIREN in France, 9 digits; the BCE number in Belgium, 10), SIRET (14 digits), VAT number, trade register city, share capital (a decimal string), registered office, and the electronic invoicing settings. A first save needs \`legalName\`, \`legalForm\`, \`companyNumber\`, \`registeredAddress\`, \`registeredPostalCode\` and \`registeredCity\`; \`country\` defaults to the store's. Later, send only the fields to change; null clears an optional one. A profile missing a required field, or with one in the wrong format, is refused with \`LEGAL_PROFILE_INVALID\`, each field and its problem in \`details.problems\`. With \`invoicingEnabled: true\`, Louez generates the store's invoices; it needs \`vatRegime\`. The setting itself transmits nothing: an invoice goes to the tax network only when the store has an active SuperPDP integration and its legal profile is in France or Belgium, and is otherwise marked not applicable for transmission. A change of \`invoicingEnabled\`, \`vatRegime\` or \`hasVatOnDebits\` ${REST_CONFIRMS}; the identity alone is saved directly. Returns the profile. ${REST_LINKS_NOTE}`,
  })
  .input(upsertLegalProfileInput)
  .output(upsertLegalProfileOutput)
  .handler(async ({ context, input, path }) => {
    const settings = context.store.settings;
    const profile = await upsertLegalProfile(settingsActor(context), input, {
      fallbackCountry: settings?.billingAddress?.country ?? settings?.country ?? "FR",
      confirm: confirmUnderLock<LegalProfilePreview>(context, path, input, (preview) => ({
        consequences: ["change"],
        state: preview.changes,
        details: { changes: preview.changes },
      })),
    });
    return { profile, links: links(context, "invoicing") };
  });

export const dashboardSettingsRouter = {
  get,
  updateStoreInfo: updateStoreInfoProcedure,
  updateCompany: updateCompanyProcedure,
  updateLegal: updateLegalProcedure,
  updateReservationRules: updateReservationRulesProcedure,
  updateBusinessHours: updateBusinessHoursProcedure,
  updateDelivery: updateDeliveryProcedure,
  createLocation: createLocationProcedure,
  updateLocation: updateLocationProcedure,
  setLocationActive: setLocationActiveProcedure,
  updateTaxes: updateTaxesProcedure,
  getLegalProfile: getLegalProfileProcedure,
  searchCompanyRegistry: searchCompanyRegistryProcedure,
  upsertLegalProfile: upsertLegalProfileProcedure,
};
