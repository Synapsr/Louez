/** The setup progress as a small ring, filled in the Lagon primary. */
export const SetupProgressRing = ({ progress }: { progress: number }) => {
  const radius = 10;
  const circumference = radius * 2 * Math.PI;

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0 -rotate-90">
      <circle cx="12" cy="12" r={radius} fill="none" stroke="currentColor" strokeWidth="3.5" className="text-border" />
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeDasharray={circumference}
        strokeDashoffset={circumference - (progress / 100) * circumference}
        strokeLinecap="round"
        className="text-primary ease-lagon transition-[stroke-dashoffset] duration-500"
      />
    </svg>
  );
};
