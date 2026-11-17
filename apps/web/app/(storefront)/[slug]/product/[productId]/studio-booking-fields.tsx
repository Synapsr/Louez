"use client";

import type { Ref } from "react";
import { Input, Label } from "@louez/ui";
import { cn } from "@louez/utils";

import type { StudioBookingValues } from "@/lib/utils/util.studio-booking";

export interface StudioBookingFieldsProps {
  values: StudioBookingValues;
  onChange: (values: StudioBookingValues) => void;
  errors: Partial<Record<keyof StudioBookingValues, string>>;
  showErrors: boolean;
  containerRef?: Ref<HTMLDivElement>;
}

export const StudioBookingFields = ({
  values,
  onChange,
  errors,
  showErrors,
  containerRef,
}: StudioBookingFieldsProps) => {
  const updateField = <K extends keyof StudioBookingValues>(
    field: K,
    value: StudioBookingValues[K],
  ) => {
    onChange({
      ...values,
      [field]: value,
    });
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-4 rounded-xl border border-border/80 bg-muted/20 p-4 text-card-foreground shadow-xs"
    >
      <div className="flex flex-col gap-0.5 border-b border-border/60 pb-2.5">
        <h3 className="text-sm font-semibold tracking-tight text-foreground sm:text-base">
          Konfiguracja studia
        </h3>
        <p className="text-xs text-muted-foreground">
          Wypełnij poniższe opcje, aby dodać rezerwację do koszyka
        </p>
      </div>

      {/* 1. Godziny obecności klienta */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="studio-client-hours" className="text-xs font-medium sm:text-sm">
          Godziny obecności klienta <span className="text-destructive">*</span>
        </Label>
        <Input
          id="studio-client-hours"
          value={values.clientPresenceHours}
          onChange={(e) => updateField("clientPresenceHours", e.target.value)}
          placeholder="np. 08:00 – 18:00"
          className={cn(showErrors && errors.clientPresenceHours && "border-destructive/80")}
        />
        {showErrors && errors.clientPresenceHours ? (
          <span className="text-xs text-destructive">{errors.clientPresenceHours}</span>
        ) : null}
      </div>

      {/* 2. Godziny zdjęć/produkcji */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="studio-production-hours" className="text-xs font-medium sm:text-sm">
          Godziny zdjęć / produkcji <span className="text-destructive">*</span>
        </Label>
        <Input
          id="studio-production-hours"
          value={values.productionHours}
          onChange={(e) => updateField("productionHours", e.target.value)}
          placeholder="np. 09:00 – 17:00"
          className={cn(showErrors && errors.productionHours && "border-destructive/80")}
        />
        {showErrors && errors.productionHours ? (
          <span className="text-xs text-destructive">{errors.productionHours}</span>
        ) : null}
      </div>

      {/* 3. Pakiet kawowy (powyżej 8os.) */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium sm:text-sm">
          Pakiet kawowy (powyżej 8 os.) <span className="text-destructive">*</span>
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => updateField("coffeePackage", "nie")}
            className={cn(
              "flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors sm:text-sm",
              values.coffeePackage === "nie"
                ? "border-primary bg-primary text-primary-foreground shadow-xs font-semibold"
                : "border-input bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            Nie
          </button>
          <button
            type="button"
            onClick={() => updateField("coffeePackage", "tak")}
            className={cn(
              "flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors sm:text-sm",
              values.coffeePackage === "tak"
                ? "border-primary bg-primary text-primary-foreground shadow-xs font-semibold"
                : "border-input bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            Tak
          </button>
        </div>
        {showErrors && errors.coffeePackage ? (
          <span className="text-xs text-destructive">{errors.coffeePackage}</span>
        ) : null}
      </div>

      {/* 4. Sam wynajem studia czy support eN */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium sm:text-sm">
          Sam wynajem studia czy support eN <span className="text-destructive">*</span>
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => updateField("rentalType", "wynajem")}
            className={cn(
              "flex h-9 items-center justify-center rounded-lg border px-2 text-center text-xs font-medium transition-colors sm:text-sm",
              values.rentalType === "wynajem"
                ? "border-primary bg-primary text-primary-foreground shadow-xs font-semibold"
                : "border-input bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            Sam wynajem studia
          </button>
          <button
            type="button"
            onClick={() => updateField("rentalType", "support")}
            className={cn(
              "flex h-9 items-center justify-center rounded-lg border px-2 text-center text-xs font-medium transition-colors sm:text-sm",
              values.rentalType === "support"
                ? "border-primary bg-primary text-primary-foreground shadow-xs font-semibold"
                : "border-input bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            Support eN
          </button>
        </div>
        {showErrors && errors.rentalType ? (
          <span className="text-xs text-destructive">{errors.rentalType}</span>
        ) : null}
      </div>

      {/* 5. Czy potrzebny sprzęt foto/video? Jaki? */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium sm:text-sm">
          Czy potrzebny sprzęt foto/video? <span className="text-destructive">*</span>
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => updateField("equipmentOption", "nie")}
            className={cn(
              "flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors sm:text-sm",
              values.equipmentOption === "nie"
                ? "border-primary bg-primary text-primary-foreground shadow-xs font-semibold"
                : "border-input bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            Nie
          </button>
          <button
            type="button"
            onClick={() => updateField("equipmentOption", "tak")}
            className={cn(
              "flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors sm:text-sm",
              values.equipmentOption === "tak"
                ? "border-primary bg-primary text-primary-foreground shadow-xs font-semibold"
                : "border-input bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            Tak
          </button>
        </div>
        {showErrors && errors.equipmentOption ? (
          <span className="text-xs text-destructive">{errors.equipmentOption}</span>
        ) : null}

        {values.equipmentOption === "tak" ? (
          <div className="mt-1 flex flex-col gap-1">
            <Label htmlFor="studio-equipment-details" className="text-xs text-muted-foreground">
              Jaki sprzęt jest potrzebny? <span className="text-destructive">*</span>
            </Label>
            <Input
              id="studio-equipment-details"
              value={values.equipmentDetails}
              onChange={(e) => updateField("equipmentDetails", e.target.value)}
              placeholder="np. lampy Profoto, aparaty, statywy, modyfikatory..."
              className={cn(showErrors && errors.equipmentDetails && "border-destructive/80")}
            />
            {showErrors && errors.equipmentDetails ? (
              <span className="text-xs text-destructive">{errors.equipmentDetails}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 6. Potrzebne meble? Jakie? */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium sm:text-sm">
          Potrzebne meble? <span className="text-destructive">*</span>
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => updateField("furnitureOption", "nie")}
            className={cn(
              "flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors sm:text-sm",
              values.furnitureOption === "nie"
                ? "border-primary bg-primary text-primary-foreground shadow-xs font-semibold"
                : "border-input bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            Nie
          </button>
          <button
            type="button"
            onClick={() => updateField("furnitureOption", "tak")}
            className={cn(
              "flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors sm:text-sm",
              values.furnitureOption === "tak"
                ? "border-primary bg-primary text-primary-foreground shadow-xs font-semibold"
                : "border-input bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            Tak
          </button>
        </div>
        {showErrors && errors.furnitureOption ? (
          <span className="text-xs text-destructive">{errors.furnitureOption}</span>
        ) : null}

        {values.furnitureOption === "tak" ? (
          <div className="mt-1 flex flex-col gap-1">
            <Label htmlFor="studio-furniture-details" className="text-xs text-muted-foreground">
              Jakie meble są potrzebne? <span className="text-destructive">*</span>
            </Label>
            <Input
              id="studio-furniture-details"
              value={values.furnitureDetails}
              onChange={(e) => updateField("furnitureDetails", e.target.value)}
              placeholder="np. kanapa, stolik kawowy, fotele, regał..."
              className={cn(showErrors && errors.furnitureDetails && "border-destructive/80")}
            />
            {showErrors && errors.furnitureDetails ? (
              <span className="text-xs text-destructive">{errors.furnitureDetails}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 7. Cyklorama na czysto (malowana) */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium sm:text-sm">
          Cyklorama na czysto (malowana) <span className="text-destructive">*</span>
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => updateField("cycloramaClean", "tak")}
            className={cn(
              "flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors sm:text-sm",
              values.cycloramaClean === "tak"
                ? "border-primary bg-primary text-primary-foreground shadow-xs font-semibold"
                : "border-input bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            Tak
          </button>
          <button
            type="button"
            onClick={() => updateField("cycloramaClean", "nie")}
            className={cn(
              "flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors sm:text-sm",
              values.cycloramaClean === "nie"
                ? "border-primary bg-primary text-primary-foreground shadow-xs font-semibold"
                : "border-input bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            Nie
          </button>
        </div>
        {showErrors && errors.cycloramaClean ? (
          <span className="text-xs text-destructive">{errors.cycloramaClean}</span>
        ) : null}
      </div>

      {/* 8. Odświeżenie cykloramy między dniami */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium sm:text-sm">
          Odświeżenie cykloramy między dniami <span className="text-destructive">*</span>
        </Label>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => updateField("cycloramaRefresh", "nie_dotyczy")}
            className={cn(
              "flex h-9 items-center justify-center rounded-lg border px-2 text-center text-xs font-medium transition-colors",
              values.cycloramaRefresh === "nie_dotyczy"
                ? "border-primary bg-primary text-primary-foreground shadow-xs font-semibold"
                : "border-input bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            Nie dotyczy
          </button>
          <button
            type="button"
            onClick={() => updateField("cycloramaRefresh", "tak")}
            className={cn(
              "flex h-9 items-center justify-center rounded-lg border px-2 text-center text-xs font-medium transition-colors",
              values.cycloramaRefresh === "tak"
                ? "border-primary bg-primary text-primary-foreground shadow-xs font-semibold"
                : "border-input bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            Tak
          </button>
          <button
            type="button"
            onClick={() => updateField("cycloramaRefresh", "nie")}
            className={cn(
              "flex h-9 items-center justify-center rounded-lg border px-2 text-center text-xs font-medium transition-colors",
              values.cycloramaRefresh === "nie"
                ? "border-primary bg-primary text-primary-foreground shadow-xs font-semibold"
                : "border-input bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            Nie
          </button>
        </div>
        {showErrors && errors.cycloramaRefresh ? (
          <span className="text-xs text-destructive">{errors.cycloramaRefresh}</span>
        ) : null}
      </div>
    </div>
  );
};
