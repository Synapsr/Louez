export interface StudioBookingValues {
  clientPresenceHours: string;
  productionHours: string;
  coffeePackage: "nie" | "tak" | "";
  rentalType: "wynajem" | "support" | "";
  equipmentOption: "nie" | "tak" | "";
  equipmentDetails: string;
  furnitureOption: "nie" | "tak" | "";
  furnitureDetails: string;
  cycloramaClean: "tak" | "nie" | "";
  cycloramaRefresh: "nie_dotyczy" | "tak" | "nie" | "";
}

export const initialStudioBookingValues: StudioBookingValues = {
  clientPresenceHours: "",
  productionHours: "",
  coffeePackage: "",
  rentalType: "",
  equipmentOption: "",
  equipmentDetails: "",
  furnitureOption: "",
  furnitureDetails: "",
  cycloramaClean: "",
  cycloramaRefresh: "",
};

export interface StudioBookingValidationResult {
  isValid: boolean;
  errors: Partial<Record<keyof StudioBookingValues, string>>;
}

export const validateStudioBookingValues = (
  values: StudioBookingValues,
): StudioBookingValidationResult => {
  const errors: Partial<Record<keyof StudioBookingValues, string>> = {};

  if (!values.clientPresenceHours.trim()) {
    errors.clientPresenceHours = "Podaj godziny obecności klienta (np. 08:00 - 18:00)";
  }

  if (!values.productionHours.trim()) {
    errors.productionHours = "Podaj godziny zdjęć / produkcji (np. 09:00 - 17:00)";
  }

  if (!values.coffeePackage) {
    errors.coffeePackage = "Wybierz opcję pakietu kawowego";
  }

  if (!values.rentalType) {
    errors.rentalType = "Wybierz zakres wynajmu";
  }

  if (!values.equipmentOption) {
    errors.equipmentOption = "Wybierz, czy potrzebny jest sprzęt foto/video";
  } else if (values.equipmentOption === "tak" && !values.equipmentDetails.trim()) {
    errors.equipmentDetails = "Określ, jaki sprzęt foto/video jest potrzebny";
  }

  if (!values.furnitureOption) {
    errors.furnitureOption = "Wybierz, czy potrzebne są meble";
  } else if (values.furnitureOption === "tak" && !values.furnitureDetails.trim()) {
    errors.furnitureDetails = "Określ, jakie meble są potrzebne";
  }

  if (!values.cycloramaClean) {
    errors.cycloramaClean = "Wybierz opcję cykloramy na czysto";
  }

  if (!values.cycloramaRefresh) {
    errors.cycloramaRefresh = "Wybierz opcję odświeżenia cykloramy między dniami";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

export const formatStudioAttributes = (
  values: StudioBookingValues,
): Record<string, string> => {
  return {
    "Godziny obecności klienta": values.clientPresenceHours.trim(),
    "Godziny zdjęć/produkcji": values.productionHours.trim(),
    "Pakiet kawowy (powyżej 8os.)": values.coffeePackage === "tak" ? "Tak" : "Nie",
    "Sam wynajem czy support": values.rentalType === "support" ? "Support eN" : "Sam wynajem studia",
    "Sprzęt foto/video":
      values.equipmentOption === "tak"
        ? `Tak: ${values.equipmentDetails.trim()}`
        : "Nie",
    "Potrzebne meble":
      values.furnitureOption === "tak"
        ? `Tak: ${values.furnitureDetails.trim()}`
        : "Nie",
    "Cyklorama na czysto (malowana)": values.cycloramaClean === "tak" ? "Tak" : "Nie",
    "Odświeżenie cykloramy między dniami":
      values.cycloramaRefresh === "tak"
        ? "Tak"
        : values.cycloramaRefresh === "nie"
          ? "Nie"
          : "Nie dotyczy",
  };
};
