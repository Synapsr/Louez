import type { ReactNode } from "react";

interface LegalSectionProps {
  title: string;
  children: ReactNode;
}

/** One titled block of a legal page: heading on the type scale, quiet body. */
export const LegalSection = ({ title, children }: LegalSectionProps) => (
  <section className="flex flex-col gap-3">
    <h2 className="text-lg font-semibold leading-snug">{title}</h2>
    <div className="flex flex-col gap-3 text-pretty text-sm text-muted-foreground sm:text-base">
      {children}
    </div>
  </section>
);
