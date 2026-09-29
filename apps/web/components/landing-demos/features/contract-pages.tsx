"use client";

import { useEffect, useRef } from "react";

import { ContractPageImage } from "@/components/landing-demos/features/contract-page-image";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import manifest from "@/public/demo-documents/manifest.json";

export const ContractPages = ({ validation = false }: { validation?: boolean }) => {
  const locale = useDemoLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !validation) return;
    const target = container.querySelector<HTMLElement>('[data-demo-target="contract-validation"]');
    if (!target) return;
    // Scroll only this PDF ground. Do not scroll or focus the marketing page.
    container.scrollTop =
      target.getBoundingClientRect().top - container.getBoundingClientRect().top - 160;
  }, [validation]);
  return (
    <div
      ref={containerRef}
      data-demo-target="contract-pages"
      className="bg-muted -mx-4 -my-4 h-[calc(100svh-3.5rem)] overflow-y-auto overscroll-contain px-6 py-8 sm:-mx-6 md:-my-6 lg:-mx-8"
    >
      <div className="flex flex-col gap-6">
        {Array.from({ length: manifest.contract[locale] }, (_, index) => index + 1).map((page) => (
          <ContractPageImage key={`${locale}-${page}`} page={page} />
        ))}
      </div>
    </div>
  );
};
