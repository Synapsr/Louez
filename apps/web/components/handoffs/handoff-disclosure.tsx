interface HandoffDisclosureProps {
  /** What the closed disclosure says: a few words. */
  label: string;
  children: React.ReactNode;
}

/**
 * Context a person reads on request, on a hand-off page: a native
 * `<details>`, closed by default, which opens without JavaScript. Form
 * fields inside it are posted whether it was opened or not.
 */
export const HandoffDisclosure = ({ label, children }: HandoffDisclosureProps) => (
  <details className="group/disclosure rounded-lg border">
    <summary className="text-muted-foreground hover:text-foreground cursor-pointer px-3 py-2 text-sm font-medium select-none">
      {label}
    </summary>
    <div className="space-y-3 border-t px-3 py-3">{children}</div>
  </details>
);
