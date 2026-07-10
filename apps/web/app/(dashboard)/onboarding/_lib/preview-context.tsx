'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

export interface OnboardingPreviewState {
  storeName: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  theme: 'light' | 'dark';
  reservationMode: 'request' | 'payment';
  userName: string;
  userImage: string | null;
  userSeed: string;
}

const DEFAULT_PREVIEW: OnboardingPreviewState = {
  storeName: '',
  slug: '',
  logoUrl: null,
  primaryColor: '#0066FF',
  theme: 'light',
  reservationMode: 'request',
  userName: '',
  userImage: null,
  userSeed: 'louez',
};

interface OnboardingPreviewContextValue {
  preview: OnboardingPreviewState;
  updatePreview: (patch: Partial<OnboardingPreviewState>) => void;
}

const OnboardingPreviewContext =
  createContext<OnboardingPreviewContextValue | null>(null);

export function OnboardingPreviewProvider({
  children,
  initial,
}: {
  children: React.ReactNode;
  initial?: Partial<OnboardingPreviewState>;
}) {
  const [preview, setPreview] = useState({ ...DEFAULT_PREVIEW, ...initial });

  const updatePreview = useCallback(
    (patch: Partial<OnboardingPreviewState>) => {
      setPreview((prev) => ({ ...prev, ...patch }));
    },
    [],
  );

  const value = useMemo(
    () => ({ preview, updatePreview }),
    [preview, updatePreview],
  );

  return (
    <OnboardingPreviewContext.Provider value={value}>
      {children}
    </OnboardingPreviewContext.Provider>
  );
}

export function useOnboardingPreview() {
  const context = useContext(OnboardingPreviewContext);
  if (!context) {
    throw new Error(
      'useOnboardingPreview must be used within OnboardingPreviewProvider',
    );
  }
  return context;
}
