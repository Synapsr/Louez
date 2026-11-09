import type { ReactNode } from "react";

export function OnboardingStepHeader({
  title,
  description,
}: {
  /** Rich so a step can brand a wordmark inside its title. */
  title: ReactNode;
  /** Optional: a title that already says it all stands alone. */
  description?: string;
}) {
  return (
    <div className="mb-8 space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>}
    </div>
  );
}
