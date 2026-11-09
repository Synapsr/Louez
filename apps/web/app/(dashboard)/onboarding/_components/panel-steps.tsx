interface PanelStepsProps {
  steps: ReadonlyArray<{ key: string; title: string; detail?: string }>;
}

/**
 * Numbered steps joined by a thin line, shared by the side panels that explain
 * a sequence (activating Stripe, handling a booking request).
 */
export const PanelSteps = ({ steps }: PanelStepsProps) => (
  <ol className="space-y-0">
    {steps.map((step, index) => (
      <li key={step.key} className="relative flex gap-3 pb-3.5 last:pb-0">
        {index < steps.length - 1 && (
          <span aria-hidden className="bg-border absolute start-3.25 top-7.5 bottom-0.5 w-0.5 rounded-full" />
        )}
        <span className="bg-accent text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums">
          {index + 1}
        </span>
        <div className="flex min-w-0 flex-col pt-1 text-sm">
          <span className="font-medium">{step.title}</span>
          {step.detail && <span className="text-muted-foreground text-xs">{step.detail}</span>}
        </div>
      </li>
    ))}
  </ol>
);
