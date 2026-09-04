/** Section heading of the onboarding side panels, shared by every variant. */
export const PanelSectionTitle = ({ children }: { children: React.ReactNode }) => {
  return (
    <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
      {children}
    </h2>
  );
};
