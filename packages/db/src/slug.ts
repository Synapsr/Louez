/** Longest slug stored for a product or a category. */
export const SLUG_MAX_LENGTH = 80;

/**
 * URL slug of a human name: lowercase ASCII letters, digits and single
 * hyphens. Accents are folded ("Vélo électrique" → "velo-electrique") so the
 * word stays readable in the address bar and in search results.
 */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[œŒ]/g, "oe")
    .replace(/[æÆ]/g, "ae")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

/** Whether a value is a slug `slugify` could have produced. */
export function isSlug(value: string): boolean {
  return (
    value.length > 0 && value.length <= SLUG_MAX_LENGTH && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}

/**
 * The first slug not already taken: `base`, then `base-2`, `base-3`… A name
 * that slugifies to nothing (emoji only, for instance) yields the fallback.
 */
export function pickUniqueSlug(
  base: string,
  taken: ReadonlySet<string>,
  fallback = "item",
): string {
  const root = base || fallback;
  if (!taken.has(root)) return root;

  for (let suffix = 2; ; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${root.slice(0, SLUG_MAX_LENGTH - tail.length).replace(/-+$/g, "")}${tail}`;
    if (!taken.has(candidate)) return candidate;
  }
}
