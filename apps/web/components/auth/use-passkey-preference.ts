"use client";

import { useSyncExternalStore } from "react";
import { prefersPasskey } from "./util.passkey-preferences";

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};
const getServerSnapshot = () => false;

export const usePasskeyPreference = (): boolean =>
  useSyncExternalStore(subscribe, prefersPasskey, getServerSnapshot);
