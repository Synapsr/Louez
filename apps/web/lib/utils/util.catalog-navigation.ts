import { getCheckoutReturnHref } from "./util.checkout-return";

export const resolveCatalogNavigation = (href: string, catalogHref: string): string => {
  const saved = getCheckoutReturnHref(catalogHref);
  if (href === "/catalog") return saved;
  if (href.startsWith("/catalog?")) {
    const next = new URLSearchParams(saved.split("?")[1] ?? "");
    const overrides = new URLSearchParams(href.slice("/catalog?".length));
    for (const key of new Set(overrides.keys())) {
      next.delete(key);
      for (const value of overrides.getAll(key)) next.append(key, value);
    }
    return `/catalog?${next}`;
  }
  if (/^\/product\/[^/?#]+(?:\?|$)/.test(href) || href === "/checkout") {
    const [pathname, query] = href.split("?");
    const params = new URLSearchParams(query);
    if (saved !== "/catalog" && !params.has("returnTo")) params.set("returnTo", saved);
    return params.size ? `${pathname}?${params}` : href;
  }
  return href;
};
