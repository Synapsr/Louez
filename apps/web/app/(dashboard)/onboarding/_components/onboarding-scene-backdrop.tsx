/**
 * The ground of the onboarding right column: a Lagon and Écume mist with a
 * faint dot grid fading out from the centre, so the preview reads as placed
 * on a scene rather than on a blank page. Purely decorative and still.
 */
export const OnboardingSceneBackdrop = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0">
    <div className="from-ecume-soft absolute -top-1/4 -right-1/4 size-[70%] rounded-full bg-radial to-transparent to-70%" />
    <div className="from-accent absolute -bottom-1/4 -left-1/4 size-[80%] rounded-full bg-radial to-transparent to-70%" />
    <div className="absolute inset-0 bg-[radial-gradient(color-mix(in_oklch,var(--color-primary)_16%,transparent)_1px,transparent_1px)] [mask-image:radial-gradient(70%_60%_at_50%_50%,#000,transparent)] bg-size-[20px_20px]" />
  </div>
);
