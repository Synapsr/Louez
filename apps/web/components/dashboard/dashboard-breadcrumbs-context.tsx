'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { usePathname } from 'next/navigation';

interface DashboardBreadcrumbsContextValue {
  labels: Record<string, string>;
  setLabel: (pathname: string, label: string) => void;
  clearLabel: (pathname: string) => void;
}

const DashboardBreadcrumbsContext =
  createContext<DashboardBreadcrumbsContextValue | null>(null);

export const DashboardBreadcrumbsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [labels, setLabels] = useState<Record<string, string>>({});

  const setLabel = useCallback((pathname: string, label: string) => {
    setLabels((currentLabels) => ({
      ...currentLabels,
      [pathname]: label,
    }));
  }, []);

  const clearLabel = useCallback((pathname: string) => {
    setLabels((currentLabels) => {
      const remainingLabels = { ...currentLabels };
      delete remainingLabels[pathname];

      return remainingLabels;
    });
  }, []);

  const value = useMemo(
    () => ({ labels, setLabel, clearLabel }),
    [clearLabel, labels, setLabel],
  );

  return (
    <DashboardBreadcrumbsContext.Provider value={value}>
      {children}
    </DashboardBreadcrumbsContext.Provider>
  );
};

export const useDashboardBreadcrumbs = () => {
  const context = useContext(DashboardBreadcrumbsContext);

  if (!context) {
    throw new Error(
      'useDashboardBreadcrumbs must be used within DashboardBreadcrumbsProvider.',
    );
  }

  return context;
};

export const DashboardBreadcrumbLabel = ({ label }: { label: string }) => {
  const pathname = usePathname();
  const { clearLabel, setLabel } = useDashboardBreadcrumbs();

  useEffect(() => {
    setLabel(pathname, label);

    return () => clearLabel(pathname);
  }, [clearLabel, label, pathname, setLabel]);

  return null;
};
