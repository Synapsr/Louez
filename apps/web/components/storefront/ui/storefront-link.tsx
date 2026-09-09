"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

import { useStore } from "@/contexts/store-context";
import { resolveStorefrontHref } from "@/lib/util.storefront-href";

type StorefrontLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  /** Store-relative path (`/catalog`, `/product/abc`). External URLs pass through. */
  href: string;
};

/**
 * `next/link` for every storefront navigation. Replaces the bare `<a>` and
 * `useStorefrontUrl().getUrl()` calls that computed the prefix in an effect
 * and rendered the wrong href on first paint. `basePath` is empty outside
 * the storefront tree, so links render unprefixed there.
 */
export const StorefrontLink = ({
  href,
  prefetch,
  onMouseEnter,
  onFocus,
  ...props
}: StorefrontLinkProps) => {
  const { basePath = "" } = useStore();

  const router = useRouter();
  const resolvedHref = resolveStorefrontHref(basePath, href);
  const pathname = href.split(/[?#]/, 1)[0];
  const isBrowsePage = ["/", "/catalog", "/about", "/terms", "/legal"].includes(pathname ?? "");
  const isAccountPage =
    pathname === "/account" || /^\/account\/reservations\/[^/]+$/.test(pathname ?? "");
  const isCheckoutPage = pathname === "/checkout";
  const isProductPage = /^\/product\/[^/]+$/.test(pathname ?? "");
  const shouldPrefetch = prefetch ?? (isBrowsePage ? true : undefined);
  const warmRoute = () => {
    if (
      (isBrowsePage || isProductPage || isAccountPage || isCheckoutPage) &&
      shouldPrefetch !== false
    )
      router.prefetch(resolvedHref);
  };

  return (
    <Link
      href={resolvedHref}
      prefetch={shouldPrefetch}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        warmRoute();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        warmRoute();
      }}
      {...props}
    />
  );
};
