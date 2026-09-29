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
  /** Set where the page is not the one in the address bar: a demo scene. */
  pathname?: string;
  labels: Record<string, string>;
  setLabel: (pathname: string, label: string) => void;
  clearLabel: (pathname: string) => void;
}

const DashboardBreadcrumbsContext =
  createContext<DashboardBreadcrumbsContextValue | null>(null);

export const DashboardBreadcrumbsProvider = ({
  children,
  pathname,
}: {
  children: React.ReactNode;
  pathname?: string;
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
    () => ({ pathname, labels, setLabel, clearLabel }),
    [clearLabel, labels, pathname, setLabel],
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

interface DashboardBreadcrumbLabelProps {
  label: string;
  pathname?: string;
}

export const DashboardBreadcrumbLabel = ({
  label,
  pathname,
}: DashboardBreadcrumbLabelProps) => {
  const currentPathname = usePathname();
  const {
    clearLabel,
    setLabel,
    pathname: providedPathname,
  } = useDashboardBreadcrumbs();
  const labelPathname = pathname ?? providedPathname ?? currentPathname;

  useEffect(() => {
    setLabel(labelPathname, label);

    return () => clearLabel(labelPathname);
  }, [clearLabel, label, labelPathname, setLabel]);

  return null;
};
