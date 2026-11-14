import { z } from "zod";

/**
 * What an API key may be granted, and the presets the dashboard offers when a
 * key is created. No database here: the dashboard's form reads it too.
 */

const permissionLevel = z.enum(["none", "read", "write"]);
const analyticsPermissionLevel = z.enum(["none", "read"]);

/**
 * What an API key may be granted: a key holds no other domain. The domains
 * added with the agent-ready API are optional, as keys created before them
 * hold none, and a missing domain reads as `none` (`normalizeScopes`).
 */
export const apiKeyPermissionsSchema = z.object({
  reservations: permissionLevel,
  products: permissionLevel,
  customers: permissionLevel,
  categories: permissionLevel,
  payments: permissionLevel,
  analytics: analyticsPermissionLevel,
  settings: permissionLevel,
  online_store: permissionLevel.optional(),
  team: permissionLevel.optional(),
  billing: permissionLevel.optional(),
  integrations: permissionLevel.optional(),
});

/** Every domain a key may hold, in the order the dashboard's form lists them. */
export const API_KEY_DOMAINS = apiKeyPermissionsSchema.keyof().options;

export type ApiKeyDomain = (typeof API_KEY_DOMAINS)[number];

/** A level for every domain a key may hold: what a preset grants. */
type ApiKeyGrant = Required<z.infer<typeof apiKeyPermissionsSchema>>;

/**
 * The presets of the dashboard's form. "Full access" is every domain a key may
 * hold, analytics read-only. Actions that need a person's approval or a
 * hand-off page still ask for one, whatever the key holds.
 */
export const API_KEY_PERMISSION_PRESETS = {
  full: {
    reservations: "write",
    products: "write",
    customers: "write",
    categories: "write",
    payments: "write",
    analytics: "read",
    settings: "write",
    online_store: "write",
    team: "write",
    billing: "write",
    integrations: "write",
  },
  readOnly: {
    reservations: "read",
    products: "read",
    customers: "read",
    categories: "read",
    payments: "read",
    analytics: "read",
    settings: "read",
    online_store: "read",
    team: "read",
    billing: "read",
    integrations: "read",
  },
  // The day's work: no store settings, nor the storefront, team, billing or
  // integrations.
  operations: {
    reservations: "write",
    products: "read",
    customers: "write",
    categories: "read",
    payments: "write",
    analytics: "read",
    settings: "none",
    online_store: "none",
    team: "none",
    billing: "none",
    integrations: "none",
  },
} as const satisfies Record<string, ApiKeyGrant>;

export type ApiKeyPermissionPreset = keyof typeof API_KEY_PERMISSION_PRESETS;
