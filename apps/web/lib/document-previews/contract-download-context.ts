"use client";

import { createContext } from "react";

/** Optional local document destination, inherited by a nested reservation header. */
export const ContractDownloadContext = createContext<(() => void) | undefined>(undefined);
