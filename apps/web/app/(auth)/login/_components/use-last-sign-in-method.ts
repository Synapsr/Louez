"use client";

import { useSyncExternalStore } from "react";

import { readLastSignInMethod, type LastSignInMethod } from "./util.last-sign-in-method";

// The value only changes when this very page signs the user in, and it then
// navigates away: there is nothing to subscribe to.
const subscribe = () => () => {};

const getServerSnapshot = (): LastSignInMethod | null => null;

/**
 * Sign-in method remembered from the previous visit. The server cannot know
 * it, so it renders the default step; `useSyncExternalStore` switches to the
 * remembered one right after hydration without a mismatch — a lazy `useState`
 * initialiser reading localStorage would render a different tree on each side.
 */
export const useLastSignInMethod = (): LastSignInMethod | null =>
  useSyncExternalStore(subscribe, readLastSignInMethod, getServerSnapshot);
