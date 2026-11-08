import {
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
  "Its `links` hold the dashboard page of these settings and, once the store is online, its storefront: give the user these URLs, never build one.";

const CONFIRM_HELP =
  "Customers see this change at checkout, so when it changes something the first call answers CONFIRMATION_REQUIRED with a preview of each value before and after: show it to the user, and once they agree, call again with the same arguments and the confirmationToken.";

const links = (context: ProductContext, page: SettingsPage) =>
  settingsLinks(context.ports.urls, context.store, page);

/** The confirmation of a settings write, bound to each value it changes. */
const confirmChanges = (context: ProductContext, path: readonly string[], input: unknown) =>
  confirmUnderLock<SettingsPreview>(context, path, input, (preview) => ({
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
      description: `Everything a store is set up with, in one call: its info and contact (store), company (country, time zone, currency, billing address), legal texts (terms, legal notice), the storefront (web address, URL, theme, logos, banner photos), reservation rules (booking mode, durations, notice, buffers, extensions), business hours and closures, delivery and pickup points (locations), taxes, and whether Stripe takes payments. Read it before changing a setting: each section has its settings_update_* tool, which takes the same field names. ${LINKS_HELP}`,
      bundle: "settings",
      aliases: [{ name: "get_store_settings" }],
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
  })
  .route({ method: "GET", path: "/settings" })
  .input(getSettingsInput)
  .output(getSettingsOutput)
  .handler(async ({ context }) => {
    const { row: _row, ...settings } = await getSettings(context.actor.storeId);
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
      description: `Change the store's name, description and contact details (email, phone, address, coordinates), as the storefront shows them. Send only the fields to change; null clears one. Send latitude and longitude with a new address: delivery distances are measured from them. The description takes plain text (blank lines make paragraphs) or simple HTML. Returns the store info. ${LINKS_HELP}`,
      bundle: "settings",
      aliases: [{ name: "update_store_info" }],
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/settings/store-info" })
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
      description: `Change the company's country (it sets the time zone), the currency of every price, and the billing address printed on contracts and invoices. Send only the fields to change. A new country or currency changes what customers see and pay: the first call answers CONFIRMATION_REQUIRED with a preview: show it to the user, and once they agree, call again with the same arguments and the confirmationToken. Returns the company settings. ${LINKS_HELP}`,
      bundle: "settings",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/settings/company" })
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
      description: `Change the store's legal texts: terms and conditions (cgv), legal notice, whether the full terms are printed in rental contracts, and the storefront's footer note. Send only the fields to change; null clears a text. Texts take plain text (blank lines make paragraphs) or simple HTML, ${SETTINGS_LIMITS.richText} characters at most. Returns the legal texts, with the online store editor's legal page in \`links\`: give the user that URL.`,
      bundle: "settings",
      aliases: [{ name: "update_store_legal" }],
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/settings/legal" })
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
      description: `Change how customers book: the booking mode (payment online, or request the store accepts), the share paid online, the shortest and longest rental, the notice before a rental starts, the buffer after each return, whether checkout asks for an address, and extensions. Durations are in minutes. Send only the fields to change. Payment mode needs Stripe connected (STRIPE_REQUIRED otherwise). A change of the booking mode or of the share paid online is seen at checkout: the first call answers CONFIRMATION_REQUIRED with a preview: show it to the user, and once they agree, call again with the same arguments and the confirmationToken. Returns the rules. ${LINKS_HELP}`,
      bundle: "settings",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/settings/reservation-rules" })
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
      description: `Change the store's opening hours and closures: pickups and returns are only offered within them. Days are named (monday…sunday), each open or closed with up to 4 ranges (HH:mm, in the store's time zone); days left out stay as they are. closurePeriods replaces every closure: send the current ones (settings_get) with your change. Returns the hours. ${LINKS_HELP}`,
      bundle: "settings",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/settings/business-hours" })
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
      description: `Change delivery to the customer's address: on or off, its mode, the fee per kilometre and the lowest fee (decimal strings in the store's currency), the farthest distance, the order amount from which it is free, and whether customers may pick one of the store's pickup points. Send only the fields to change. Delivery needs the store's coordinates (STORE_COORDINATES_REQUIRED otherwise). ${CONFIRM_HELP} Returns the delivery settings. ${LINKS_HELP}`,
      bundle: "settings",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/settings/delivery" })
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
      description: `Add a pickup and return point customers can choose at checkout (once the delivery settings allow pickup points): a name, an address, and its coordinates when you have them. A store has 50 at most. Returns the point, with its id for settings_update_location. ${LINKS_HELP} Pass an idempotencyKey to retry safely.`,
      bundle: "settings",
    },
  })
  .route({ method: "POST", path: "/settings/locations" })
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
      description: `Change a pickup point: send its id and only the fields to change; null clears one. Returns the point. ${LINKS_HELP}`,
      bundle: "settings",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/settings/locations/{id}" })
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
      description: `Show (true) or hide (false) a pickup point at checkout. Reservations that already use it keep it. Returns the point. ${LINKS_HELP}`,
      bundle: "settings",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "POST", path: "/settings/locations/{id}/active" })
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
      description: `Change the store's taxes: on or off, the default rate in percent (20 for 20 %), whether prices include tax (inclusive, TTC) or have it added (exclusive, HT), the tax's label and the store's tax number. Send only the fields to change; null clears the label or the number. ${CONFIRM_HELP} Returns the taxes. ${LINKS_HELP}`,
      bundle: "settings",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/settings/taxes" })
  .input(updateTaxesInput)
  .output(updateTaxesOutput)
  .handler(async ({ context, input, path }) => ({
    taxes: await updateTaxes(settingsActor(context), input, {
      confirm: confirmChanges(context, path, input),
    }),
    links: links(context, "taxes"),
  }));

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
};
