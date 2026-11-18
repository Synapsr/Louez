/** Whether a sidebar entry is the current page, or holds it. */
export const isNavigationItemActive = (pathname: string, href: string) => {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
};

/**
 * A sub-entry is the current page when the path is its own, unless a sibling
 * deeper under it matches too: on /dashboard/visibility/ai, the entry for
 * /dashboard/visibility stays off.
 */
export const isSubItemActive = (
  pathname: string,
  subItem: { href: string },
  siblings: readonly { href: string }[],
) =>
  isNavigationItemActive(pathname, subItem.href) &&
  !siblings.some(
    (sibling) =>
      sibling.href.length > subItem.href.length &&
      sibling.href.startsWith(`${subItem.href}/`) &&
      isNavigationItemActive(pathname, sibling.href),
  );
