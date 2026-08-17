import { z } from "zod";

import { env } from "@/env";
import { signCatalogRequest } from "@/lib/catalog-auth";

const marketplaceMatchResponseSchema = z.object({
  data: z.array(
    z.object({
      businessId: z.string().trim().min(1).max(255),
      slug: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      name: z.string().trim().min(1).max(255),
      address: z.string().trim().max(500),
      citySlug: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      distanceM: z.number().finite().nonnegative().nullable(),
      score: z.number().finite(),
    }),
  ),
});

export type MarketplaceMatchCandidate = z.infer<
  typeof marketplaceMatchResponseSchema
>["data"][number];

const MATCH_PATH = "/api/integration/match";
const MATCH_TIMEOUT_MS = 4000;

export function inferMarketplaceMatchCity(address: string | null): string | null {
  if (!address) return null;

  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    const postalMatch = part.match(/^\d{4,5}\s+(.+)$/u);
    if (postalMatch?.[1]) return postalMatch[1];
  }

  return null;
}

export async function fetchMarketplaceMatches(params: {
  name: string;
  latitude: string | number | null;
  longitude: string | number | null;
  city?: string | null;
}): Promise<MarketplaceMatchCandidate[] | null> {
  const baseUrl = env.MARKETPLACE_URL;
  const secret = env.MARKETPLACE_CATALOG_SECRET;
  const name = params.name.trim();
  if (
    params.latitude === null ||
    params.longitude === null ||
    params.latitude.toString().trim() === "" ||
    params.longitude.toString().trim() === ""
  ) {
    return null;
  }
  const latitude = Number(params.latitude);
  const longitude = Number(params.longitude);
  if (
    !baseUrl ||
    !secret ||
    name.length === 0 ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(MATCH_PATH, baseUrl);
    url.searchParams.set("name", name);
    url.searchParams.set("lat", latitude.toString());
    url.searchParams.set("lng", longitude.toString());
    const city = params.city?.trim();
    if (city) {
      url.searchParams.set("city", city);
    }
  } catch {
    return null;
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  let signature: string;
  try {
    signature = await signCatalogRequest({
      method: "GET",
      pathAndQuery: `${url.pathname}${url.search}`,
      secret,
      timestamp,
    });
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MATCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "x-catalog-signature": signature,
        "x-catalog-timestamp": timestamp,
      },
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    return null;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  const parsed = marketplaceMatchResponseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.data.length === 0) {
    return null;
  }

  return parsed.data.data;
}
