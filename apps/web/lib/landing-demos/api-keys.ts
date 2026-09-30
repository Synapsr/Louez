import type { ApiKeyItem } from "@/app/(dashboard)/dashboard/settings/integrations/mcp/api-keys-page-content";
import { getDemoToday } from "./reservations";
import { createDemoPeriod } from "./fixtures";

const daysAgo = (days: number) => {
  const date = getDemoToday(createDemoPeriod());
  date.setDate(date.getDate() - days);
  return date;
};

/** Two keys of the shop: one for its accounting export, one for an assistant that only reads. */
export const getDemoApiKeys = (): ApiKeyItem[] => [
  {
    id: "demo-key-accounting",
    name: "Export comptable",
    keyPrefix: "lz_8f2c",
    permissions: {
      reservations: "read",
      products: "none",
      customers: "read",
      categories: "none",
      payments: "read",
      analytics: "read",
      settings: "none",
    },
    lastUsedAt: daysAgo(1),
    expiresAt: null,
    createdAt: daysAgo(64),
    revokedAt: null,
  },
  {
    id: "demo-key-assistant",
    name: "Assistant de l’atelier",
    keyPrefix: "lz_41ab",
    permissions: {
      reservations: "write",
      products: "read",
      customers: "write",
      categories: "read",
      payments: "write",
      analytics: "read",
      settings: "none",
    },
    lastUsedAt: daysAgo(0),
    expiresAt: null,
    createdAt: daysAgo(12),
    revokedAt: null,
  },
];
