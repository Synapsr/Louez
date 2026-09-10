/** Only a store-relative catalog URL is accepted as a checkout return destination. */
export const getCheckoutReturnHref = (value: string | null): string => {
  if (!value || (value !== "/catalog" && !value.startsWith("/catalog?"))) return "/catalog";
  return value;
};

export const buildCheckoutHref = (storePath: string, search: string): string => {
  if (storePath !== "/catalog") return "/checkout";
  const returnTo = search ? `/catalog?${search}` : "/catalog";
  return `/checkout?${new URLSearchParams({ returnTo })}`;
};
