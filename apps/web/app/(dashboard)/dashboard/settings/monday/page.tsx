import { redirect } from "next/navigation";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { getCurrentStore } from "@/lib/store-context";

import { getMondayDashboardState } from "./actions";
import { MondaySettingsForm } from "./monday-settings-form";

export const instant = false;

export default async function MondayIntegrationSettingsPage() {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const stateResult = await getMondayDashboardState();
  if (stateResult.status === "error") {
    redirect("/dashboard/settings");
  }

  return (
    <SettingsPageShell
      title="Integracja monday.com"
      description="Asynchroniczna synchronizacja rezerwacji i ich statusów z monday.com oraz zbiorcza checklista sprzętu i pomieszczeń do przygotowania."
    >
      <MondaySettingsForm initialState={stateResult.data} />
    </SettingsPageShell>
  );
}
