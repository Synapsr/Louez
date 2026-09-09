"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useRouter, useSearchParams } from "next/navigation";

import { useDebouncedCallback } from "use-debounce";

import { useStorefrontBasePath } from "@/contexts/store-context";
import { useStorePath } from "@/hooks/use-store-path";
import { resolveStorefrontHref } from "@/lib/util.storefront-href";
import { applyCatalogParams, buildCatalogHref } from "@/lib/utils/util.rental-browse";

/** Typing pause before the query reaches the URL and the server. */
const SEARCH_DEBOUNCE_MS = 300;
const CATALOG_PATH = "/catalog";

interface StorefrontSearchValue {
  /**
   * What the field shows. The catalog filters its loaded grid on this at
   * once, without waiting for the URL to come back with the server's answer.
   */
  draft: string;
  /** Types into the field; on the catalog the URL follows after a pause. */
  setDraft: (value: string) => void;
  clear: () => void;
  /** Enter, or the field's button: opens the catalog when we are not there yet. */
  submit: () => void;
}

const NO_SEARCH: StorefrontSearchValue = {
  draft: "",
  setDraft: () => {},
  clear: () => {},
  submit: () => {},
};

const StorefrontSearchContext = createContext<StorefrontSearchValue | null>(null);

/**
 * The storefront's one search query, owned above both of its ends: the field
 * in the header types into it, the catalog reads it. The header sits in the
 * layout and the catalog in a page, so neither can hold the state for the
 * other.
 */
export const StorefrontSearchProvider = ({ children }: { children: ReactNode }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const basePath = useStorefrontBasePath() ?? "";
  const onCatalog = useStorePath() === CATALOG_PATH;
  const committed = searchParams.get("search")?.trim() ?? "";

  const [draft, setDraftState] = useState(committed);
  /**
   * The last query we put in the URL ourselves. Re-seeding the field on every
   * URL change would fight the typist — our own debounced write lands while
   * they are still typing — so only a query that came from somewhere else
   * (the back button, "clear filters", a link) replaces the draft.
   */
  const written = useRef(committed);

  useEffect(() => {
    if (committed !== written.current) {
      written.current = committed;
      setDraftState(committed);
    }
  }, [committed]);

  const write = useCallback(
    (value: string) => {
      written.current = value;
      const next = applyCatalogParams(new URLSearchParams(window.location.search), {
        search: value || null,
      });

      window.history.replaceState(
        null,
        "",
        resolveStorefrontHref(basePath, buildCatalogHref(next)),
      );
    },
    [basePath],
  );

  const debouncedWrite = useDebouncedCallback(write, SEARCH_DEBOUNCE_MS);

  const setDraft = useCallback(
    (value: string) => {
      setDraftState(value);

      if (onCatalog) {
        debouncedWrite(value);
      }
    },
    [debouncedWrite, onCatalog],
  );

  const clear = useCallback(() => {
    debouncedWrite.cancel();
    setDraftState("");

    if (onCatalog) {
      write("");
    }
  }, [debouncedWrite, onCatalog, write]);

  const submit = useCallback(() => {
    debouncedWrite.cancel();
    const trimmed = draft.trim();

    if (onCatalog) {
      write(trimmed);
      return;
    }

    // Off the catalog the query is the whole request: start from a clean
    // query string rather than dragging the current page's params along.
    written.current = trimmed;
    const next = applyCatalogParams(new URLSearchParams(), { search: trimmed || null });

    router.push(resolveStorefrontHref(basePath, buildCatalogHref(next)));
  }, [basePath, debouncedWrite, draft, onCatalog, router, write]);

  const value = useMemo(
    () => ({ draft, setDraft, clear, submit }),
    [clear, draft, setDraft, submit],
  );

  return (
    <StorefrontSearchContext.Provider value={value}>{children}</StorefrontSearchContext.Provider>
  );
};

/** No-ops outside the provider (the embed shell mounts no header). */
export const useStorefrontSearch = (): StorefrontSearchValue =>
  useContext(StorefrontSearchContext) ?? NO_SEARCH;
