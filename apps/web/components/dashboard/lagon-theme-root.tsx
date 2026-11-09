"use client";

import { useLayoutEffect } from "react";

const LAGON_THEME_CLASS = "theme-lagon";

/**
 * Puts the Lagon theme class on <html> while a back-office page is mounted.
 *
 * The shell already wears the class, but menus, dialogs, sheets and tooltips
 * portal to <body>, outside it — without this they would fall back to the
 * neutral storefront palette. The class comes off on unmount, so a client-side
 * hop to a storefront route never inherits the back-office theme.
 */
export const LagonThemeRoot = () => {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add(LAGON_THEME_CLASS);
    return () => root.classList.remove(LAGON_THEME_CLASS);
  }, []);

  return null;
};
