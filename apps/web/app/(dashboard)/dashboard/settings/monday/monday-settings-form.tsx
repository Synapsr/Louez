"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  AlertCircle,
  CheckCircle2,
  Copy,
  KeyRound,
  Layers,
  ListChecks,
  PlugZap,
  RefreshCw,
  Save,
  ShieldAlert,
  Sparkles,
  Webhook,
} from "lucide-react";

import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
  Textarea,
  toastManager,
} from "@louez/ui";

import type { MondayBoardInspectionResult } from "@/lib/integrations/monday/monday-client";

import {
  type MondayDashboardState,
  saveMondayIntegrationSettings,
  testAndInspectMondayBoard,
  triggerMondayManualSync,
} from "./actions";

interface MondaySettingsFormProps {
  initialState: MondayDashboardState;
}

type ColumnFieldMeta = {
  key: keyof MondayDashboardState["columnConfig"];
  label: string;
  mondayType: string;
  placeholder: string;
  description: string;
  required?: boolean;
};

const MAIN_ITEM_COLUMN_FIELDS: ColumnFieldMeta[] = [
  {
    key: "statusColumnId",
    label: "ID kolumny Statusu rezerwacji (Wymagane dla 2-kierunkowej synchronizacji)",
    mondayType: "Status (color)",
    placeholder: "np. status lub color_mk123",
    description:
      "Główna kolumna statusu operacyjnego na tablicy monday.com. Louez zapisuje w niej aktualny status rezerwacji (np. Gotowa do wydania, Wydana, Anulowane) oraz nasłuchuje zmian tej kolumny przez Webhook.",
    required: true,
  },
  {
    key: "timelineColumnId",
    label: "ID kolumny Timeline (Oś czasu Od – Do)",
    mondayType: "Timeline",
    placeholder: "np. timeline lub timerange_mk123",
    description:
      "Kolumna osi czasu (zakres dat od dnia wydania do dnia zwrotu). Idealna do widoku Gantt / Kalendarz w monday.com.",
  },
  {
    key: "startDateColumnId",
    label: "ID kolumny Daty i godziny wydania (Start Date)",
    mondayType: "Date (z godziną)",
    placeholder: "np. date4 lub date_mk123",
    description:
      "Opcjonalna osobna kolumna typu Date przechowująca dokładną datę oraz godzinę rozpoczęcia wynajmu (wydania sprzętu/pomieszczenia).",
  },
  {
    key: "endDateColumnId",
    label: "ID kolumny Daty i godziny zwrotu (End Date)",
    mondayType: "Date (z godziną)",
    placeholder: "np. date_1 lub date_mk456",
    description:
      "Opcjonalna osobna kolumna typu Date przechowująca dokładną datę oraz godzinę zakończenia wynajmu (zwrotu sprzętu).",
  },
  {
    key: "customerColumnId",
    label: "ID kolumny Klienta (Nazwa firmy lub Imię i nazwisko)",
    mondayType: "Text",
    placeholder: "np. text_customer lub text1",
    description:
      "Kolumna tekstowa, do której Louez wpisze nazwę firmy (dla klientów B2B) lub imię i nazwisko klienta indywidualnego.",
  },
  {
    key: "emailColumnId",
    label: "ID kolumny E-mail klienta",
    mondayType: "Email lub Text",
    placeholder: "np. email lub email_mk123",
    description: "Kolumna typu Email, w której zostanie zapisany adres e-mail klienta.",
  },
  {
    key: "phoneColumnId",
    label: "ID kolumny Telefon klienta",
    mondayType: "Phone lub Text",
    placeholder: "np. phone lub text_phone",
    description: "Kolumna typu Phone lub Text z numerem telefonu kontaktowego klienta.",
  },
  {
    key: "linkColumnId",
    label: "ID kolumny Link do rezerwacji w Louez",
    mondayType: "Link",
    placeholder: "np. link lub link_to_louez",
    description:
      "Kolumna typu Link zawierająca bezpośredni odnośnik URL do szczegółów rezerwacji w panelu Dashboard Louez.",
  },
  {
    key: "numberColumnId",
    label: "ID kolumny Numer rezerwacji",
    mondayType: "Text",
    placeholder: "np. text_number",
    description:
      "Kolumna tekstowa przechowująca sam numer rezerwacji (np. 2026-0042). Uwaga: numer jest też zawsze dodawany na początku nazwy głównego Itemu.",
  },
  {
    key: "totalColumnId",
    label: "ID kolumny Kwota całkowita rezerwacji",
    mondayType: "Numbers lub Text",
    placeholder: "np. numbers lub numbers_total",
    description: "Kolumna liczbowa (Numbers), do której trafia wartość zamówienia brutto.",
  },
  {
    key: "notesColumnId",
    label: "ID kolumny Notatki i Logistyka",
    mondayType: "Long Text",
    placeholder: "np. long_text lub notes",
    description:
      "Kolumna typu Long Text, w której zapisywane są godziny odbioru/zwrotu, adresy dostawy, osoba wprowadzająca, uwagi klienta oraz notatki wewnętrzne.",
  },
];

const STATUS_LABEL_FIELDS: Array<{
  key: keyof MondayDashboardState["statusLabels"];
  louezBadge: string;
  title: string;
  description: string;
}> = [
  {
    key: "pending",
    louezBadge: "pending",
    title: "Nowa rezerwacja oczekująca (pending)",
    description:
      "Etykieta statusu w monday.com ustawiana, gdy klient złożył zapytanie/rezerwację oczekującą na potwierdzenie.",
  },
  {
    key: "quote",
    louezBadge: "quote",
    title: "Oferta / Wycena (quote)",
    description:
      "Etykieta statusu w monday.com dla rezerwacji utworzonych jako niezobowiązująca wycena dla klienta.",
  },
  {
    key: "confirmed",
    louezBadge: "confirmed",
    title: "Potwierdzona / Gotowa do wydania (confirmed)",
    description:
      "Etykieta statusu w monday.com dla potwierdzonej rezerwacji. Zmiana statusu w monday.com na tę etykietę automatycznie zmieni status rezerwacji w Louez na 'confirmed' (i zarezerwuje stany magazynowe).",
  },
  {
    key: "ongoing",
    louezBadge: "ongoing",
    title: "Wydana klientowi / W trakcie realizacji (ongoing)",
    description:
      "Etykieta statusu w monday.com oznaczająca wydanie sprzętu lub rozpoczęcie najmu. Zmiana statusu na tę etykietę w monday.com ustawia w Louez status 'ongoing' oraz zapisuje datę i godzinę wydania (pickedUpAt).",
  },
  {
    key: "completed",
    louezBadge: "completed",
    title: "Zwrócona / Zakończona (completed)",
    description:
      "Etykieta statusu w monday.com po odbiorze sprzętu od klienta. Zmiana na tę etykietę w monday.com zamyka rezerwację w Louez ('completed') i rejestruje czas zwrotu (returnedAt).",
  },
  {
    key: "cancelled",
    louezBadge: "cancelled",
    title: "Anulowana (cancelled)",
    description:
      "Etykieta statusu w monday.com dla anulowanych rezerwacji. Zgodnie z zasadami bezpieczeństwa Louez NIGDY nie kasuje głównego Itemu przy anulowaniu — zmienia jego status na tę etykietę i dodaje komentarz (Update) dla magazynu.",
  },
  {
    key: "rejected",
    louezBadge: "rejected",
    title: "Odrzucona (rejected)",
    description:
      "Etykieta statusu w monday.com ustawiana, gdy zapytanie rezerwacyjne zostanie odrzucone przez obsługę.",
  },
  {
    key: "declined",
    louezBadge: "declined",
    title: "Wycena odrzucona przez klienta (declined)",
    description: "Etykieta statusu w monday.com ustawiana, gdy klient odrzuci przesłaną wycenę.",
  },
];

export const MondaySettingsForm = ({ initialState }: MondaySettingsFormProps) => {
  const router = useRouter();
  const [isSaving, startSaveTransition] = useTransition();
  const [isTesting, startTestTransition] = useTransition();
  const [isSyncing, startSyncTransition] = useTransition();

  const [enabled, setEnabled] = useState(initialState.enabled);
  const [apiToken, setApiToken] = useState("");
  const [clearApiToken, setClearApiToken] = useState(false);
  const [apiVersion, setApiVersion] = useState(initialState.apiVersion || "2024-10");
  const [boardId, setBoardId] = useState(initialState.boardId);
  const [groupId, setGroupId] = useState(initialState.groupId);
  const [subitemBoardId, setSubitemBoardId] = useState(initialState.subitemBoardId);
  const [botUserId, setBotUserId] = useState(initialState.botUserId);
  const [webhookSecret, setWebhookSecret] = useState(initialState.webhookSecret);
  const [columnConfig, setColumnConfig] = useState(initialState.columnConfig);
  const [statusLabels, setStatusLabels] = useState(initialState.statusLabels);
  const [webhookStatusMapJson, setWebhookStatusMapJson] = useState(
    initialState.webhookStatusMapJson,
  );

  const [inspection, setInspection] = useState<MondayBoardInspectionResult | null>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);

  const updateColumnField = (key: keyof MondayDashboardState["columnConfig"], value: string) => {
    setColumnConfig((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const updateStatusLabel = (key: keyof MondayDashboardState["statusLabels"], value: string) => {
    setStatusLabels((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toastManager.add({
        type: "success",
        title: `Skopiowano ${label} do schowka`,
      });
    } catch {
      toastManager.add({
        type: "error",
        title: "Nie udało się skopiować do schowka",
      });
    }
  };

  const handleTestAndInspect = () => {
    setInspectionError(null);
    startTestTransition(async () => {
      const result = await testAndInspectMondayBoard({
        apiToken: apiToken.trim() || undefined,
        apiVersion,
        boardId,
        subitemBoardId,
      });

      if (result.status === "error") {
        setInspectionError(result.error);
        toastManager.add({
          type: "error",
          title: result.error,
        });
        return;
      }

      setInspection(result.inspection);

      // Automatically fill Bot User ID and Subitem Board ID if empty
      if (result.inspection.currentUser?.id && !botUserId.trim()) {
        setBotUserId(result.inspection.currentUser.id);
      }
      if (result.inspection.board?.detectedSubitemBoardId && !subitemBoardId.trim()) {
        setSubitemBoardId(result.inspection.board.detectedSubitemBoardId);
      }

      toastManager.add({
        type: "success",
        title: `Połączono z tablicą "${result.inspection.board?.name}"! Wykryto ${result.inspection.board?.columns.length ?? 0} kolumn.`,
      });
    });
  };

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    startSaveTransition(async () => {
      const result = await saveMondayIntegrationSettings({
        enabled,
        apiToken: apiToken.trim() || undefined,
        clearApiToken,
        apiVersion,
        boardId,
        groupId,
        subitemBoardId,
        botUserId,
        webhookSecret,
        columnConfig,
        statusLabels,
        webhookStatusMapJson,
      });

      if (result.status === "error") {
        toastManager.add({
          type: "error",
          title: result.error,
        });
        return;
      }

      setApiToken("");
      setClearApiToken(false);
      toastManager.add({
        type: "success",
        title: "Konfiguracja integracji monday.com została zapisana.",
      });
      router.refresh();
    });
  };

  const handleManualSync = (enqueueActiveReservations: boolean) => {
    startSyncTransition(async () => {
      const result = await triggerMondayManualSync({ enqueueActiveReservations });
      if (result.status === "error") {
        toastManager.add({
          type: "error",
          title: result.error,
        });
        return;
      }

      toastManager.add({
        type: "success",
        title: enqueueActiveReservations
          ? `Dodano do kolejki ${result.enqueued} rezerwacji. Zsynchronizowano teraz: ${result.synced} (błędy: ${result.failed}).`
          : `Przetworzono kolejkę monday.com: zsynchronizowano ${result.synced} (błędy: ${result.failed}).`,
      });
      router.refresh();
    });
  };

  const computedWebhookUrl = `${initialState.webhookUrl.split("?")[0]}?storeId=${encodeURIComponent(initialState.storeId)}&secret=${encodeURIComponent(webhookSecret)}`;

  return (
    <form onSubmit={handleSave} className="space-y-6 pb-16">
      {/* 1. STATUS INTEGRACJI & KOLEJKA */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <PlugZap className="h-5 w-5 text-primary" />
                Status integracji monday.com (Dwukierunkowa synchronizacja)
              </CardTitle>
              <CardDescription>
                Louez pełni rolę Single Source of Truth (SSOT) dla struktury rezerwacji, dat,
                klienta, sprzętu oraz wynajętych pomieszczeń (tworząc główny Item oraz Subitems).
                monday.com jest źródłem prawdy dla statusu realizacji operacyjnej na magazynie.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={enabled ? "success" : "expired"}>
                {enabled ? "Aktywna" : "Wyłączona"}
              </Badge>
              <Switch id="monday-enabled-switch" checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs uppercase">Zsynchronizowane Itemy</p>
              <p className="mt-1 text-xl font-semibold">{initialState.queueStats.syncedCount}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs uppercase">Oczekujące w kolejce</p>
              <p className="mt-1 text-xl font-semibold">{initialState.queueStats.pendingCount}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs uppercase">Błędy (Retry z Backoff)</p>
              <p className="mt-1 text-xl font-semibold text-destructive">
                {initialState.queueStats.failedCount}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs uppercase">Ostatnia synchronizacja</p>
              <p className="mt-1 text-sm font-medium">
                {initialState.lastSyncAt
                  ? new Date(initialState.lastSyncAt).toLocaleString("pl-PL")
                  : "Brak"}
              </p>
            </div>
          </div>

          {initialState.lastError && (
            <Alert variant="error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Ostatni błąd synchronizacji:</strong> {initialState.lastError}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              disabled={isSyncing}
              onClick={() => handleManualSync(false)}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Przetwórz oczekujące / ponów błędy teraz
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isSyncing}
              onClick={() => handleManualSync(true)}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Wymuś pełną synchronizację aktywnych rezerwacji (-30 dni / +12 mies.)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 2. DANE DOSTĘPOWE API & TABLICE */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            1. Połączenie z API GraphQL monday.com i identyfikatory tablic
          </CardTitle>
          <CardDescription>
            Skonfiguruj token dostępowy API v2 (plan PRO), wersję API oraz identyfikatory tablicy
            docelowej. Token jest szyfrowany algorytmem AES-256-GCM przed zapisem w bazie danych.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            {/* API Token */}
            <div className="space-y-1.5">
              <Label htmlFor="monday-api-token">Token API monday.com (`MONDAY_API_TOKEN`) *</Label>
              <Input
                id="monday-api-token"
                type="password"
                value={apiToken}
                onChange={(e) => {
                  setApiToken(e.target.value);
                  if (e.target.value) setClearApiToken(false);
                }}
                placeholder={
                  initialState.hasApiToken && !clearApiToken
                    ? `Zapisany token: ${initialState.apiTokenMasked}`
                    : "Wklej token API v2 z monday.com..."
                }
              />
              <p className="text-muted-foreground text-xs">
                <strong>Opis:</strong> Osobisty token API v2 konta technicznego (bota) lub
                administratora w monday.com (Awatar &rarr; Developers &rarr; My access tokens).
                Pozostaw pole puste, jeśli nie chcesz zmieniać wcześniej zapisanego tokena.
              </p>
              {initialState.hasApiToken && !clearApiToken && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-destructive"
                  onClick={() => setClearApiToken(true)}
                >
                  Usuń zapisany token
                </Button>
              )}
            </div>

            {/* API Version */}
            <div className="space-y-1.5">
              <Label htmlFor="monday-api-version">Wersja API GraphQL (`MONDAY_API_VERSION`)</Label>
              <Input
                id="monday-api-version"
                value={apiVersion}
                onChange={(e) => setApiVersion(e.target.value)}
                placeholder="2024-10"
              />
              <p className="text-muted-foreground text-xs">
                <strong>Opis:</strong> Wersja API wysyłana w nagłówku `API-Version` do
                `https://api.monday.com/v2`. Domyślnie `2024-10`.
              </p>
            </div>

            {/* Board ID */}
            <div className="space-y-1.5">
              <Label htmlFor="monday-board-id">
                ID Głównej Tablicy Rezerwacji (`MONDAY_BOARD_ID`) *
              </Label>
              <Input
                id="monday-board-id"
                value={boardId}
                onChange={(e) => setBoardId(e.target.value)}
                placeholder="np. 9876543210"
              />
              <p className="text-muted-foreground text-xs">
                <strong>Opis:</strong> Numeryczny identyfikator tablicy (Board), na której każda
                rezerwacja z Louez jest tworzona jako główny Item. Znajdziesz go w adresie URL
                tablicy w przeglądarce: `monday.com/boards/9876543210`.
              </p>
            </div>

            {/* Group ID */}
            <div className="space-y-1.5">
              <Label htmlFor="monday-group-id">
                ID Grupy na tablicy (`MONDAY_GROUP_ID`) – opcjonalne
              </Label>
              <Input
                id="monday-group-id"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                placeholder="np. topics lub group_title"
              />
              <p className="text-muted-foreground text-xs">
                <strong>Opis:</strong> Identyfikator grupy (sekcji) na głównej tablicy, do której
                mają trafiać nowe rezerwacje. Jeśli pozostawisz puste, monday.com umieści rezerwację
                w pierwszej domyślnej grupie na tablicy.
              </p>
            </div>

            {/* Subitem Board ID */}
            <div className="space-y-1.5">
              <Label htmlFor="monday-subitem-board-id">
                ID Tablicy Subitemów (`MONDAY_SUBITEM_BOARD_ID`) – automatyczne / opcjonalne
              </Label>
              <Input
                id="monday-subitem-board-id"
                value={subitemBoardId}
                onChange={(e) => setSubitemBoardId(e.target.value)}
                placeholder="Wykrywane automatycznie (np. 9876543299)"
              />
              <p className="text-muted-foreground text-xs">
                <strong>Opis:</strong> W architekturze monday.com podzadania (Subitems — czyli
                produkty do wydania oraz wynajęte pomieszczenia do przygotowania) żyją na osobnej,
                ukrytej tablicy. Louez wykrywa i zapisuje to ID automatycznie po kliknięciu
                przycisku „Testuj połączenie i pobierz kolumny" poniżej lub przy pierwszym
                utworzeniu podzadania.
              </p>
            </div>

            {/* Bot User ID */}
            <div className="space-y-1.5">
              <Label htmlFor="monday-bot-user-id">
                ID Konta Bota / Integracji (`MONDAY_BOT_USER_ID`) *
              </Label>
              <Input
                id="monday-bot-user-id"
                value={botUserId}
                onChange={(e) => setBotUserId(e.target.value)}
                placeholder="np. 12345678"
              />
              <p className="text-muted-foreground text-xs">
                <strong>Opis (Ochrona przed pętlą nieskończoną):</strong> Numeryczne ID użytkownika
                monday.com, do którego należy powyższy Token API. monday.com wysyła webhooki nawet
                dla zmian wykonanych przez API — podanie tego ID sprawia, że Louez natychmiast
                ignoruje webhooki wywołane przez samego siebie. Kliknij przycisk poniżej, aby pobrać
                to ID automatycznie!
              </p>
            </div>
          </div>

          <div className="rounded-xl border bg-muted/30 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Inspektor tablicy monday.com (Autouzupełnianie ID)
                </p>
                <p className="text-muted-foreground text-xs">
                  Sprawdź połączenie GraphQL, automatycznie wypełnij `Bot User ID` oraz `Subitem
                  Board ID`, a także wyświetl listę wszystkich ID kolumn i grup z Twojej tablicy.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={isTesting}
                onClick={handleTestAndInspect}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {isTesting
                  ? "Łączenie z monday.com..."
                  : "Testuj połączenie i pobierz kolumny z tablicy"}
              </Button>
            </div>

            {inspectionError && (
              <Alert variant="error" className="mt-3">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{inspectionError}</AlertDescription>
              </Alert>
            )}

            {inspection && (
              <div className="mt-4 space-y-4 border-t pt-4 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" />
                    Połączono jako:{" "}
                    {inspection.currentUser
                      ? `${inspection.currentUser.name} (${inspection.currentUser.email}) — userId: ${inspection.currentUser.id}`
                      : "Nieznany użytkownik"}
                  </span>
                  {inspection.board && (
                    <span className="font-medium">
                      Tablica: <strong>{inspection.board.name}</strong> (ID: {inspection.board.id})
                    </span>
                  )}
                </div>

                {inspection.board && inspection.board.groups.length > 0 && (
                  <div>
                    <p className="mb-1.5 font-semibold uppercase text-muted-foreground">
                      Dostępne grupy na tablicy (kliknij, aby ustawić jako MONDAY_GROUP_ID):
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {inspection.board.groups.map((grp) => (
                        <button
                          key={grp.id}
                          type="button"
                          onClick={() => setGroupId(grp.id)}
                          className="hover:border-primary hover:bg-primary/5 rounded-md border bg-background px-2.5 py-1 text-left transition"
                        >
                          <span className="font-medium">{grp.title}</span>{" "}
                          <code className="text-muted-foreground">({grp.id})</code>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {inspection.board && (
                  <div>
                    <p className="mb-1.5 font-semibold uppercase text-muted-foreground">
                      Kolumny na głównej tablicy (skopiuj ID do odpowiedniego pola poniżej):
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                      {inspection.board.columns.map((col) => (
                        <div
                          key={col.id}
                          className="flex items-center justify-between rounded-md border bg-background px-2.5 py-1.5"
                        >
                          <div className="min-w-0 pr-2">
                            <p className="truncate font-medium">{col.title}</p>
                            <p className="text-muted-foreground">
                              ID: <code>{col.id}</code> &bull; typ: <code>{col.type}</code>
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-7 w-7 shrink-0 p-0"
                            onClick={() => handleCopy(col.id, `ID kolumny ${col.title}`)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {inspection.subitemBoard && (
                  <div>
                    <p className="mb-1.5 font-semibold uppercase text-muted-foreground">
                      Kolumny na ukrytej tablicy Subitemów (ID tablicy: {inspection.subitemBoard.id}
                      ):
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                      {inspection.subitemBoard.columns.map((col) => (
                        <div
                          key={col.id}
                          className="flex items-center justify-between rounded-md border bg-background px-2.5 py-1.5"
                        >
                          <div className="min-w-0 pr-2">
                            <p className="truncate font-medium">{col.title}</p>
                            <p className="text-muted-foreground">
                              ID: <code>{col.id}</code> &bull; typ: <code>{col.type}</code>
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-7 w-7 shrink-0 p-0"
                            onClick={() => handleCopy(col.id, `ID kolumny subitemu ${col.title}`)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 3. WEBHOOKI I OCHRONA PRZED PĘTLĄ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5 text-primary" />
            2. Konfiguracja Webhooka (monday.com &rarr; Louez) i Bezpieczeństwo
          </CardTitle>
          <CardDescription>
            Skonfiguruj odbieranie zmian statusów z monday.com. Endpoint obsługuje automatyczny
            handshake (`challenge`), natychmiast zwraca `200 OK` i przetwarza zmiany asynchronicznie
            w tle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="monday-webhook-secret">
              Tajny klucz autoryzacji Webhooka (`MONDAY_WEBHOOK_SECRET`)
            </Label>
            <div className="flex gap-2">
              <Input
                id="monday-webhook-secret"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder="Losowy sekret weryfikujący wywołania z monday.com"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => handleCopy(webhookSecret, "sekret webhooka")}
              >
                <Copy className="mr-1.5 h-4 w-4" />
                Kopiuj sekret
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              <strong>Opis:</strong> Ponieważ standardowe webhooki tablicowe monday.com nie wysyłają
              nagłówka HMAC, ten tajny token zabezpiecza endpoint `/api/webhooks/monday` przed
              nieautoryzowanymi wywołaniami z zewnątrz (porównywany odporną na ataki czasowe funkcją
              `crypto.timingSafeEqual`).
            </p>
          </div>

          <div className="space-y-1.5 rounded-xl border bg-muted/30 p-4">
            <Label>Gotowy adres URL Webhooka do wklejenia w monday.com</Label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <Input readOnly value={computedWebhookUrl} className="font-mono text-xs" />
              <Button
                type="button"
                variant="default"
                onClick={() => handleCopy(computedWebhookUrl, "URL Webhooka")}
              >
                <Copy className="mr-1.5 h-4 w-4" />
                Kopiuj URL Webhooka
              </Button>
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              <strong>Instrukcja krok po kroku w monday.com:</strong> Otwórz tablicę rezerwacji w
              monday.com &rarr; kliknij <strong>Integrate</strong> (prawy górny róg) &rarr; wyszukaj{" "}
              <strong>Webhooks</strong> &rarr; wybierz regułę{" "}
              <em>&quot;When a status changes to something, send a webhook&quot;</em> (lub{" "}
              <em>&quot;When any column changes, send a webhook&quot;</em>) &rarr; wklej powyższy
              adres URL (pamiętaj o zapisaniu zmian na dole tej strony!).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 4. MAPOWANIE KOLUMN GŁÓWNEGO ITEMU */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            3. Mapowanie kolumn głównego Itemu (1 Rezerwacja w Louez = 1 Item)
          </CardTitle>
          <CardDescription>
            Podaj techniczne ID kolumn z głównej tablicy monday.com. Pola opcjonalne, których nie
            używasz na tablicy, możesz pozostawić puste — Louez bezpiecznie je pominie.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-5 md:grid-cols-2">
            {MAIN_ITEM_COLUMN_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`col-${field.key}`}>
                    {field.label} {field.required && <span className="text-destructive">*</span>}
                  </Label>
                  <Badge variant="expired" className="text-[10px]">
                    Typ: {field.mondayType}
                  </Badge>
                </div>
                <Input
                  id={`col-${field.key}`}
                  value={columnConfig[field.key]}
                  onChange={(e) => updateColumnField(field.key, e.target.value)}
                  placeholder={field.placeholder}
                />
                <p className="text-muted-foreground text-xs">{field.description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 5. LISTA PRZYGOTOWANIA */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            4. Lista przygotowania (Subitem)
          </CardTitle>
          <CardDescription>
            Dla rezerwacji Louez tworzy jeden Subitem „Sprzęt do przygotowania”. Produkty i
            pomieszczenia, ich ilości oraz przypisane egzemplarze są publikowane w checkliście
            wewnątrz aktualizacji (Update). Nowa aktualizacja pojawia się tylko po zmianie listy.
            Istniejące podzadania utworzone przed tą zmianą pozostają bez zmian.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* 6. MAPOWANIE STATUSÓW DWUKIERUNKOWYCH */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            5. Mapowanie statusów (Louez &harr; monday.com)
          </CardTitle>
          <CardDescription>
            Określ dokładne nazwy etykiet (Labels) w kolumnie Status na tablicy monday.com, które
            odpowiadają poszczególnym stanom rezerwacji w Louez. Mapowanie działa w obie strony: gdy
            pracownik zmieni status głównego Itemu w monday.com na jedną z poniższych etykiet, Louez
            automatycznie zaktualizuje status rezerwacji w swojej bazie danych.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-5 md:grid-cols-2">
            {STATUS_LABEL_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`status-${field.key}`}>{field.title}</Label>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    Louez: {field.louezBadge}
                  </code>
                </div>
                <Input
                  id={`status-${field.key}`}
                  value={statusLabels[field.key]}
                  onChange={(e) => updateStatusLabel(field.key, e.target.value)}
                />
                <p className="text-muted-foreground text-xs">{field.description}</p>
              </div>
            ))}
          </div>

          <div className="space-y-1.5 border-t pt-4">
            <Label htmlFor="monday-webhook-status-map-json">
              Dodatkowe synonimy przychodzących statusów z monday.com (JSON – opcjonalnie)
            </Label>
            <Textarea
              id="monday-webhook-status-map-json"
              rows={4}
              className="font-mono text-xs"
              value={webhookStatusMapJson}
              onChange={(e) => setWebhookStatusMapJson(e.target.value)}
              placeholder='{"Spakowane": "confirmed", "Wydane z magazynu": "ongoing", "Rozliczone": "completed"}'
            />
            <p className="text-muted-foreground text-xs">
              <strong>Opis:</strong> Jeśli na tablicy w monday.com macie więcej etykiet statusów
              operacyjnych (np. zarówno <em>&quot;Potwierdzona&quot;</em>, jak i{" "}
              <em>&quot;Spakowane&quot;</em> mają ustawiać w Louez status <code>confirmed</code>),
              możesz wpisać tutaj obiekt JSON mapujący dodatkowe nazwy etykiet z monday.com na
              statusy Louez (<code>pending</code>, <code>confirmed</code>, <code>ongoing</code>,{" "}
              <code>completed</code>, <code>cancelled</code>, <code>rejected</code>,{" "}
              <code>quote</code>). Wielkość liter i polskie znaki są normalizowane automatycznie.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 7. OSTATNIE ZDARZENIA W KOLEJCE OUTBOX */}
      {initialState.queueStats.recentItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Ostatnio synchronizowane rezerwacje ( Kolejka Outbox )
            </CardTitle>
            <CardDescription>
              Podgląd mapowania <code>louez_reservation_id &harr; monday_item_id</code> oraz stanu
              kolejki asynchronicznej.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Rezerwacja</th>
                    <th className="pb-2 pr-3 font-medium">Monday Item ID</th>
                    <th className="pb-2 pr-3 font-medium">Status Sync</th>
                    <th className="pb-2 pr-3 font-medium">Próby</th>
                    <th className="pb-2 pr-3 font-medium">Ostatni sync</th>
                    <th className="pb-2 font-medium">Błąd</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {initialState.queueStats.recentItems.map((item) => (
                    <tr key={item.reservationId}>
                      <td className="py-2 pr-3 font-medium">#{item.reservationNumber}</td>
                      <td className="py-2 pr-3 font-mono">{item.mondayItemId || "—"}</td>
                      <td className="py-2 pr-3">
                        <Badge
                          variant={
                            item.syncStatus === "synced"
                              ? "success"
                              : item.syncStatus === "failed"
                                ? "expired"
                                : "progress"
                          }
                        >
                          {item.syncStatus}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3">{item.attemptCount}</td>
                      <td className="py-2 pr-3">
                        {item.lastSyncedAt
                          ? new Date(item.lastSyncedAt).toLocaleString("pl-PL")
                          : "—"}
                      </td>
                      <td className="max-w-xs truncate py-2 text-destructive">
                        {item.lastError || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pływający dolny pasek zapisu */}
      <div className="sticky bottom-4 z-20 flex items-center justify-end gap-3 rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur">
        <Button type="submit" disabled={isSaving}>
          <Save className="mr-2 h-4 w-4" />
          {isSaving ? "Zapisywanie konfiguracji..." : "Zapisz konfigurację monday.com"}
        </Button>
      </div>
    </form>
  );
};
