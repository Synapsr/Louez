export const normalizeCategoryToken = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const ROOM_CATEGORY_TOKENS = new Set([
  "pomieszczenia",
  "pomieszczenie",
  "sala",
  "sale",
  "studio",
  "studia",
  "pokoj",
  "pokoje",
  "room",
  "rooms",
  "space",
  "spaces",
  "venue",
  "venues",
]);

/**
 * Checks whether a category represents rooms/spaces (e.g., "Pomieszczenia", "Sale").
 */
export const isRoomCategory = (
  category: { name?: string | null; slug?: string | null } | null | undefined,
): boolean => {
  if (!category) return false;
  const name = category.name ? normalizeCategoryToken(category.name) : "";
  const slug = category.slug ? normalizeCategoryToken(category.slug) : "";

  if (ROOM_CATEGORY_TOKENS.has(name) || ROOM_CATEGORY_TOKENS.has(slug)) {
    return true;
  }

  return Array.from(ROOM_CATEGORY_TOKENS).some(
    (token) => (name.length > 0 && name.includes(token)) || (slug.length > 0 && slug.includes(token)),
  );
};

/**
 * Checks whether a product name matches "Studio Foto" or "Studio Daylight".
 */
export const isStudioRoomProduct = (product: { name: string }): boolean => {
  const name = normalizeCategoryToken(product.name);
  return name.includes("studio foto") || name.includes("studio daylight");
};

/**
 * Checks whether a product is a room/space (either via room category or studio room name).
 */
export const isRoomProduct = (product: {
  name: string;
  category?: { name?: string | null; slug?: string | null } | null;
}): boolean => {
  return isRoomCategory(product.category) || isStudioRoomProduct(product);
};
