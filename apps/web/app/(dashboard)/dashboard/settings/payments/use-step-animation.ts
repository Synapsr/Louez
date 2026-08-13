import { useEffect, useState } from "react";

// Cycles through steps 1..totalSteps to animate the flow walkthrough.
export const useStepAnimation = (totalSteps: number, intervalMs: number = 2000) => {
  const [activeStep, setActiveStep] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev >= totalSteps ? 1 : prev + 1));
    }, intervalMs);

    return () => clearInterval(interval);
  }, [totalSteps, intervalMs]);

  return activeStep;
};
