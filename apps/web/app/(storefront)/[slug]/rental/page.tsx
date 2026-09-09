import { permanentRedirect } from "next/navigation";

import { getStorefrontUrl } from "@/lib/storefront-url";

/** Params the old dated catalog accepted; the unified catalog reads the same names. */
const FORWARDED_PARAMS = ["startDate", "endDate", "category", "search"] as const;

export const instant = false;

interface RentalPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/rental` merged into `/catalog`. Old links (embed, emails, bookmarks)
 * land on the catalog with their dates, category and search intact.
 */
export default async function RentalPage({ params, searchParams }: RentalPageProps) {
  const [{ slug }, rawParams] = await Promise.all([params, searchParams]);
  const forwarded = new URLSearchParams();

  for (const key of FORWARDED_PARAMS) {
    const raw = rawParams[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) forwarded.set(key, value);
  }

  const query = forwarded.toString();
  permanentRedirect(getStorefrontUrl(slug, query ? `/catalog?${query}` : "/catalog"));
}
