'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

/**
 * Why the widget was opened. 'checkout' surfaces the reservation-validation
 * suggestion chip (required/recommended modes).
 */
export type AdvisorIntent = 'checkout' | null;

interface AdvisorContextValue {
  /** Whether the advisor is enabled for this store (widget rendered). */
  enabled: boolean;
  isOpen: boolean;
  open: (options?: { intent?: 'checkout' }) => void;
  close: () => void;
  intent: AdvisorIntent;
  clearIntent: () => void;
  /** Current conversation id, persisted per store in localStorage. */
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  /** Bumped when the advisor validates the conversation — checkout refetches. */
  validationVersion: number;
  notifyValidated: () => void;
}

const AdvisorContext = createContext<AdvisorContextValue | undefined>(
  undefined,
);

const storageKey = (storeSlug: string) => `louez_advisor_${storeSlug}`;

export function AdvisorProvider({
  children,
  storeSlug,
  enabled,
}: {
  children: ReactNode;
  storeSlug: string;
  enabled: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [intent, setIntent] = useState<AdvisorIntent>(null);
  const [conversationId, setConversationIdState] = useState<string | null>(
    null,
  );
  const [validationVersion, setValidationVersion] = useState(0);

  useEffect(() => {
    try {
      setConversationIdState(localStorage.getItem(storageKey(storeSlug)));
    } catch {
      // Storage unavailable — the conversation just won't persist
    }
  }, [storeSlug]);

  const setConversationId = useCallback(
    (id: string | null) => {
      setConversationIdState(id);
      try {
        if (id) {
          localStorage.setItem(storageKey(storeSlug), id);
        } else {
          localStorage.removeItem(storageKey(storeSlug));
        }
      } catch {
        // Storage unavailable — the conversation just won't persist
      }
    },
    [storeSlug],
  );

  const open = useCallback(
    (options?: { intent?: 'checkout' }) => {
      if (!enabled) return;
      if (options?.intent) setIntent(options.intent);
      setIsOpen(true);
    },
    [enabled],
  );

  const close = useCallback(() => setIsOpen(false), []);
  const clearIntent = useCallback(() => setIntent(null), []);
  const notifyValidated = useCallback(
    () => setValidationVersion((version) => version + 1),
    [],
  );

  const value = useMemo(
    () => ({
      enabled,
      isOpen,
      open,
      close,
      intent,
      clearIntent,
      conversationId,
      setConversationId,
      validationVersion,
      notifyValidated,
    }),
    [
      enabled,
      isOpen,
      open,
      close,
      intent,
      clearIntent,
      conversationId,
      setConversationId,
      validationVersion,
      notifyValidated,
    ],
  );

  return (
    <AdvisorContext.Provider value={value}>{children}</AdvisorContext.Provider>
  );
}

export function useAdvisor() {
  const context = useContext(AdvisorContext);
  if (context === undefined) {
    throw new Error('useAdvisor must be used within an AdvisorProvider');
  }
  return context;
}
