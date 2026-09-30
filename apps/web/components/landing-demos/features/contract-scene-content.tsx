"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { Button } from "@louez/ui";

import { DashboardSceneFrame } from "@/components/landing-demos/dashboard-scene-frame";
import { ContractPages } from "@/components/landing-demos/features/contract-pages";
import { ContractReservation } from "@/components/landing-demos/features/contract-reservation";
import { ContractDownloadContext } from "@/lib/document-previews/contract-download-context";

export const ContractSceneContent = ({
  initialView,
  validation = false,
}: {
  initialView: "document" | "reservation";
  validation?: boolean;
}) => {
  const [view, setView] = useState(initialView);
  const t = useTranslations("common");
  const showReservation = () => setView("reservation");
  const showDocument = () => setView("document");
  return (
    <DashboardSceneFrame
      page="reservations"
      pages={["reservations"]}
      onNavigate={showReservation}
      breadcrumbs={
        view === "document" ? (
          <Button
            variant="ghost"
            size="sm"
            data-demo-target="contract-back"
            onClick={showReservation}
          >
            <ArrowLeft className="size-4" />
            {t("back")}
          </Button>
        ) : undefined
      }
    >
      <ContractDownloadContext.Provider value={showDocument}>
        {view === "document" ? (
          <ContractPages validation={validation} />
        ) : (
          <ContractReservation onBack={showReservation} />
        )}
      </ContractDownloadContext.Provider>
    </DashboardSceneFrame>
  );
};
