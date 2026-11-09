import { db } from "@louez/db";
import { z } from "zod";

import { storeProcedure } from "../../platform/procedures";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  setApiKeyConfirmation,
} from "../../services/api-keys";
import { failCredentialHandoffs } from "../../services/handoffs";
import { toORPCError } from "../../utils/orpc-error";

const permissionLevel = z.enum(["none", "read", "write"]);
const analyticsPermissionLevel = z.enum(["none", "read"]);

const permissionsSchema = z.object({
  reservations: permissionLevel,
  products: permissionLevel,
  customers: permissionLevel,
  categories: permissionLevel,
  payments: permissionLevel,
  analytics: analyticsPermissionLevel,
  settings: permissionLevel,
  online_store: permissionLevel.optional(),
  integrations: permissionLevel.optional(),
  team: permissionLevel.optional(),
  billing: permissionLevel.optional(),
});

const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  keyPrefix: z.string(),
  permissions: permissionsSchema,
  confirmSensitive: z.boolean(),
  lastUsedAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
  revokedAt: z.date().nullable(),
});

// Credentials are made, read and revoked by a signed-in owner only: an agent
// that could create a key could give itself more rights than it was granted.
const credentials = storeProcedure.meta({
  scope: { domain: "settings", level: "write", role: "manage_settings" },
  actors: ["session"],
  mcp: { exclude: "credentials are managed by the owner in the dashboard only" },
});

const list = credentials
  .meta({
    capability: "settings.listApiKeys",
    scope: { domain: "settings", level: "read", role: "manage_settings" },
  })
  .output(z.array(apiKeySchema))
  .handler(async ({ context }) => {
    try {
      return await listApiKeys({ db, storeId: context.actor.storeId });
    } catch (error) {
      throw toORPCError(error);
    }
  });

const create = credentials
  .meta({ capability: "settings.createApiKey", secretOutput: true })
  .input(
    z.object({
      name: z.string().min(1).max(100),
      permissions: permissionsSchema,
      expiresAt: z.coerce
        .date()
        .refine((d) => d > new Date(), "Expiration must be in the future")
        .optional(),
    }),
  )
  .output(z.object({ id: z.string(), key: z.string(), prefix: z.string() }))
  .handler(async ({ context, input }) => {
    try {
      return await createApiKey({
        db,
        storeId: context.actor.storeId,
        userId: context.actor.credential.userId,
        name: input.name,
        permissions: input.permissions,
        expiresAt: input.expiresAt,
      });
    } catch (error) {
      throw toORPCError(error);
    }
  });

const revoke = credentials
  .meta({ capability: "settings.revokeApiKey" })
  .input(z.object({ keyId: z.string() }))
  .output(z.object({ success: z.literal(true) }))
  .handler(async ({ context, input }) => {
    try {
      await revokeApiKey({ db, storeId: context.actor.storeId, keyId: input.keyId });
      // The links it handed to the user stop working.
      await failCredentialHandoffs({ kind: "api_key", id: input.keyId });
      return { success: true as const };
    } catch (error) {
      throw toORPCError(error);
    }
  });

// Turning confirmations off lets an automation move money without a
// preview: a choice for the signed-in owner only, recorded like every write.
const updateConfirmation = credentials
  .meta({ capability: "settings.updateApiKeyConfirmation" })
  .input(z.object({ keyId: z.string(), confirmSensitive: z.boolean() }))
  .output(z.object({ success: z.literal(true) }))
  .handler(async ({ context, input }) => {
    try {
      await setApiKeyConfirmation({
        db,
        storeId: context.actor.storeId,
        keyId: input.keyId,
        confirmSensitive: input.confirmSensitive,
      });
      return { success: true as const };
    } catch (error) {
      throw toORPCError(error);
    }
  });

export const dashboardApiKeysRouter = {
  list,
  create,
  revoke,
  updateConfirmation,
};
