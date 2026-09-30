"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@louez/utils";

import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";

export const ContractPageImage = ({ page }: { page: number }) => {
  const locale = useDemoLocale();
  const t = useTranslations("dashboard.reservations");
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative mx-auto aspect-[210/297] w-full max-w-4xl shrink-0">
      {/* Stay invisible until loaded: an absent generated asset leaves only the grey ground. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/demo-documents/contract.${locale}.p${page}.webp`}
        alt={`${t("contract.download")} · ${page}`}
        width={1240}
        height={1754}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(false)}
        className={cn("h-full w-full object-contain shadow-md", !loaded && "invisible")}
      />
      {page === 1 && (
        <>
          <span
            aria-hidden="true"
            data-demo-target="contract-parties"
            className="pointer-events-none absolute top-[17%] left-[8%] h-[9%] w-[84%]"
          />
          <span
            aria-hidden="true"
            data-demo-target="contract-equipment"
            className="pointer-events-none absolute top-[43%] left-[8%] h-[9%] w-[84%]"
          />
          <span
            aria-hidden="true"
            data-demo-target="contract-totals"
            className="pointer-events-none absolute top-[53%] right-[8%] h-[9%] w-[40%]"
          />
        </>
      )}
      {page === 2 && (
        <span
          aria-hidden="true"
          data-demo-target="contract-validation"
          className="pointer-events-none absolute top-[24%] left-[51%] h-[14%] w-[41%]"
        />
      )}
    </div>
  );
};
