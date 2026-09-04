"use client";

import { useState } from "react";

import { NewReservationForm } from "./new-reservation-form";
import type { NewReservationFormProps } from "./types";

export const NewReservationFormBoundary = (props: NewReservationFormProps) => {
  const [draftVersion, setDraftVersion] = useState(0);

  return (
    <NewReservationForm
      {...props}
      key={draftVersion}
      onReservationCreated={() => setDraftVersion((version) => version + 1)}
    />
  );
};
