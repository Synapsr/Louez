"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";

import { useRouter } from "next/navigation";

import { revalidateLogic, useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Label,
  Radio,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StepContent,
  toastManager,
} from "@louez/ui";
import {
  BuildingIcon,
  CalendarCheckIcon,
  FileCheckIcon,
  InfoCircleIcon,
  MailIcon,
  SendIcon,
  WarningIcon,
} from "@louez/ui/icons";
import {
  createStoreLegalProfileSchema,
  isPlausibleVatNumber,
  vatRegimeValues,
} from "@louez/validations";
import { cn } from "@louez/utils";

import { FloatingSaveBar } from "@/components/dashboard/floating-save-bar";
import { RootError } from "@/components/form/root-error";
import type { CompanySearchResult } from "@/lib/recherche-entreprises";
import { getFieldError } from "@/hooks/form/form-context";
import { useAppForm } from "@/hooks/form/form";

import { upsertStoreLegalProfile, type StoreLegalProfileRecord } from "./actions";
import { CompanySearchField } from "./company-search-field";
import { isLegalIdentityComplete, toLegalProfileFormValues } from "./util.legal-profile-form";
import type { PdpTransmissionState, PdpVerificationStatus } from "./util.pdp-transmission";
import {
  INVOICING_SETUP_STEPS,
  isInvoicingSetupComplete,
  resolveInitialSetupStep,
  resolveSavedInvoicingChoice,
  type InvoicingChoice,
  type InvoicingSetupProgress,
  type InvoicingSetupStep,
} from "./util.setup-progress";

type InvoicingFlowProps = {
  defaultCountry: string;
  profile: StoreLegalProfileRecord | null;
  /** Server-derived snapshot; the page keys this component on it. */
  progress: InvoicingSetupProgress;
  /** Environment of the Super PDP enrollment, when one exists. */
  transmissionEnvironment: "sandbox" | "production" | null;
  /** Server-rendered body of the transmission step (Super PDP enrollment). */
  transmissionPanel: ReactNode;
  /** KYB verification of the connected company, surfaced in the overview. */
  verificationStatus: PdpVerificationStatus;
};

const transmissionBadgeVariants = {
  actionRequired: "error",
  connected: "success",
  notConnected: "tertiary",
  pending: "pending",
} as const satisfies Record<PdpTransmissionState, string>;

const stepIcons = {
  identity: BuildingIcon,
  activation: FileCheckIcon,
  transmission: SendIcon,
} as const;

const introBullets = [
  { icon: FileCheckIcon, key: "generate" },
  { icon: SendIcon, key: "transmit" },
  { icon: MailIcon, key: "receive" },
] as const;

/**
 * The page keys the flow on the legal-profile row, so the very first save
 * (row created) and the dev reset (row deleted) remount it. The wizard
 * dialog's open state lives outside React to survive that remount.
 */
let wizardStaysOpen = false;

/**
 * The electronic-invoicing setup.
 * A three-step wizard (in a dialog) guides the merchant until the setup is
 * complete, then a manage view with a status overview takes over. The page
 * keys this component on the legal-profile row, so it only remounts when the
 * row is created or deleted; between steps the local state drives the wizard.
 */
export const InvoicingFlow = ({
  defaultCountry,
  profile,
  progress,
  transmissionEnvironment,
  transmissionPanel,
  verificationStatus,
}: InvoicingFlowProps) => {
  const router = useRouter();
  const t = useTranslations("dashboard.settings.invoicing");
  const tHub = useTranslations("dashboard.settings.integrationsHub");
  const tValidation = useTranslations("validation");
  const tCommon = useTranslations("common");
  const tRoot = useTranslations();

  const setupComplete = isInvoicingSetupComplete(progress);
  const savedInvoicingChoice = resolveSavedInvoicingChoice(progress);
  const [mode, setMode] = useState<"setup" | "manage">(setupComplete ? "manage" : "setup");
  const [isWizardOpen, setIsWizardOpen] = useState(() => !setupComplete && wizardStaysOpen);
  const [step, setStep] = useState(() => resolveInitialSetupStep(progress));
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [rootError, setRootError] = useState<string | null>(null);
  const [isPrefilled, setIsPrefilled] = useState(false);
  const [isEditingIdentity, setIsEditingIdentity] = useState(false);
  const [invoicingChoice, setInvoicingChoice] = useState<InvoicingChoice | null>(
    savedInvoicingChoice,
  );
  const [isRefreshing, startRefresh] = useTransition();

  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Once the setup is done the wizard has no reason to reopen on its own.
  if (setupComplete) wizardStaysOpen = false;

  const setWizardOpen = (open: boolean) => {
    wizardStaysOpen = open;
    setIsWizardOpen(open);
  };

  const finishSetupLater = () => {
    setWizardOpen(false);
    setMode("manage");
  };

  const goToStep = (next: number) => {
    setDirection(next < step ? "backward" : "forward");
    setStep(next);
  };

  const saveMutation = useMutation({
    mutationFn: upsertStoreLegalProfile,
    onSuccess: (result, value) => {
      if (result.status === "error") {
        setRootError(tRoot(result.error));
        return;
      }
      toastManager.add({ title: t("saved"), type: "success" });
      setIsPrefilled(false);
      setIsEditingIdentity(false);
      form.options.defaultValues = value;
      form.reset();
      // Advancing inside the refresh transition keeps the current step on
      // screen (button pending) until the server data lands, so the next step
      // appears once, already up to date — no second update a beat later.
      startRefresh(() => {
        router.refresh();
        if (modeRef.current === "setup") {
          setDirection("forward");
          setStep((current) => Math.min(current + 1, INVOICING_SETUP_STEPS.length - 1));
        }
      });
    },
    onError: () => setRootError(tRoot("errors.generic")),
  });

  const form = useAppForm({
    defaultValues: toLegalProfileFormValues(profile, defaultCountry),
    validators: { onSubmit: createStoreLegalProfileSchema(tValidation) },
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    onSubmit: async ({ value }) => {
      setRootError(null);
      await saveMutation.mutateAsync(value);
    },
  });

  const isDirty = useStore(form.store, (s) => s.isDirty);
  const country = useStore(form.store, (s) => s.values.country);
  const vatNumber = useStore(form.store, (s) => s.values.vatNumber);
  const invoicingEnabled = useStore(form.store, (s) => s.values.invoicingEnabled);
  const legalName = useStore(form.store, (s) => s.values.legalName);
  const legalForm = useStore(form.store, (s) => s.values.legalForm);
  const companyNumber = useStore(form.store, (s) => s.values.companyNumber);
  const registeredAddress = useStore(form.store, (s) => s.values.registeredAddress);
  const registeredPostalCode = useStore(form.store, (s) => s.values.registeredPostalCode);
  const registeredCity = useStore(form.store, (s) => s.values.registeredCity);
  const isIdentityComplete = useStore(form.store, (s) => isLegalIdentityComplete(s.values));

  const isSaving = saveMutation.isPending || isRefreshing;

  const isFrance = country === "FR";
  const isBelgium = country === "BE";
  const showsVatWarning = !isPlausibleVatNumber(country, vatNumber);

  const companyNumberLabel = isFrance
    ? t("identity.siren")
    : isBelgium
      ? t("identity.bce")
      : t("identity.companyNumber");
  const companyNumberDescription = isFrance
    ? t("identity.sirenDescription")
    : isBelgium
      ? t("identity.bceDescription")
      : t("identity.companyNumberDescription");

  const handleCountryChange = (nextCountry: string) => {
    if (nextCountry !== "FR") {
      form.setFieldValue("siret", "");
      form.setFieldValue("rcsCity", "");
    }
  };

  const handleRegistrySelect = (company: CompanySearchResult) => {
    form.setFieldValue("legalName", company.legalName);
    if (company.legalForm) form.setFieldValue("legalForm", company.legalForm);
    form.setFieldValue("companyNumber", company.siren);
    form.setFieldValue("siret", company.siret);
    form.setFieldValue("vatNumber", company.vatNumber);
    form.setFieldValue("rcsCity", company.rcsCity);
    form.setFieldValue("registeredAddress", company.address);
    form.setFieldValue("registeredAddressComplement", company.addressComplement);
    form.setFieldValue("registeredPostalCode", company.postalCode);
    form.setFieldValue("registeredCity", company.city);
    setIsPrefilled(true);
  };

  const identityBadge = (
    <Badge variant={isIdentityComplete ? "success" : "pending"}>
      {isIdentityComplete ? t("statusComplete") : t("statusIncomplete")}
    </Badge>
  );

  const activationBadge =
    invoicingChoice === "emissionAndReception" ? (
      <Badge variant="success">{t("louezInvoicing.statusActive")}</Badge>
    ) : invoicingChoice === "receptionOnly" ? (
      <Badge variant="info">{t("louezInvoicing.statusReceptionOnly")}</Badge>
    ) : (
      <Badge variant="tertiary">{t("louezInvoicing.statusInactive")}</Badge>
    );

  const isTransmissionConnected = progress.transmissionState === "connected";

  const transmissionBadge =
    isTransmissionConnected && verificationStatus !== "verified" ? (
      <Badge variant={verificationStatus === "failed" ? "error" : "pending"}>
        {t(`transmission.verificationStatus.${verificationStatus}`)}
      </Badge>
    ) : (
      <Badge variant={transmissionBadgeVariants[progress.transmissionState]}>
        {isTransmissionConnected
          ? tHub("statusLabels.connected")
          : progress.transmissionState === "pending"
            ? t("transmission.statusPending")
            : progress.transmissionState === "actionRequired"
              ? t("transmission.statusActionRequired")
              : tHub("statusLabels.notConnected")}
      </Badge>
    );

  const sandboxBadge = isTransmissionConnected && transmissionEnvironment === "sandbox" && (
    <Badge variant="warning">{t("transmission.environments.sandbox")}</Badge>
  );

  const renderIdentityFields = () => (
    <>
      <form.AppField name="country">
        {(field) => (
          <field.CountrySelect
            label={t("identity.country")}
            description={t("identity.countryDescription")}
            onValueChange={handleCountryChange}
          />
        )}
      </form.AppField>

      {isFrance && <CompanySearchField onSelect={handleRegistrySelect} />}

      {isPrefilled && (
        <Alert variant="info">
          <InfoCircleIcon />
          <AlertTitle>{t("identity.search.prefilledTitle")}</AlertTitle>
          <AlertDescription>{t("identity.search.prefilledDescription")}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <form.AppField name="legalName">
          {(field) => (
            <field.Input
              label={t("identity.legalName")}
              placeholder={t("identity.legalNamePlaceholder")}
              description={t("identity.legalNameDescription")}
            />
          )}
        </form.AppField>

        <form.AppField name="legalForm">
          {(field) => (
            <field.Input
              label={t("identity.legalForm")}
              placeholder={t("identity.legalFormPlaceholder")}
              description={t("identity.legalFormDescription")}
            />
          )}
        </form.AppField>

        <form.AppField name="companyNumber">
          {(field) => (
            <field.Input
              label={companyNumberLabel}
              description={companyNumberDescription}
              inputMode="numeric"
            />
          )}
        </form.AppField>

        {isFrance && (
          <form.AppField name="siret">
            {(field) => (
              <field.Input
                label={`${t("identity.siret")} (${tCommon("optional")})`}
                description={t("identity.siretDescription")}
                inputMode="numeric"
              />
            )}
          </form.AppField>
        )}

        <form.AppField name="vatNumber">
          {(field) => (
            <field.Input
              label={`${t("identity.vatNumber")} (${tCommon("optional")})`}
              placeholder={isBelgium ? "BE0123456789" : "FR12345678901"}
              description={t("identity.vatNumberDescription")}
            />
          )}
        </form.AppField>

        {isFrance && (
          <form.AppField name="rcsCity">
            {(field) => (
              <field.Input
                label={`${t("identity.rcsCity")} (${tCommon("optional")})`}
                description={t("identity.rcsCityDescription")}
              />
            )}
          </form.AppField>
        )}

        <form.AppField name="shareCapital">
          {(field) => (
            <field.Input
              label={`${t("identity.shareCapital")} (${tCommon("optional")})`}
              description={t("identity.shareCapitalDescription")}
              inputMode="decimal"
            />
          )}
        </form.AppField>
      </div>

      {showsVatWarning && (
        <Alert variant="warning">
          <WarningIcon />
          <AlertTitle>{t("identity.vatNumberWarningTitle")}</AlertTitle>
          <AlertDescription>
            {isBelgium ? t("identity.vatNumberWarningBe") : t("identity.vatNumberWarningFr")}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-4 border-t pt-6">
        <p className="text-muted-foreground text-sm font-medium">{t("identity.addressSection")}</p>
        <form.AppField name="registeredAddress">
          {(field) => (
            <field.Input
              label={t("identity.address")}
              placeholder={t("identity.addressPlaceholder")}
            />
          )}
        </form.AppField>
        <form.AppField name="registeredAddressComplement">
          {(field) => (
            <field.Input label={`${t("identity.addressComplement")} (${tCommon("optional")})`} />
          )}
        </form.AppField>
        <div className="grid gap-4 sm:grid-cols-2">
          <form.AppField name="registeredPostalCode">
            {(field) => <field.Input label={t("identity.postalCode")} />}
          </form.AppField>
          <form.AppField name="registeredCity">
            {(field) => <field.Input label={t("identity.city")} />}
          </form.AppField>
        </div>
      </div>
    </>
  );

  const renderActivationFields = () => (
    <>
      {!isIdentityComplete && (
        <Alert variant="info">
          <InfoCircleIcon />
          <AlertTitle>{t("louezInvoicing.lockedTitle")}</AlertTitle>
          <AlertDescription>{t("louezInvoicing.lockedDescription")}</AlertDescription>
        </Alert>
      )}

      <form.Field name="invoicingEnabled">
        {(field) => (
          <div className="grid gap-3">
            <Label>{t("louezInvoicing.choiceLabel")}</Label>
            <RadioGroup
              value={invoicingChoice ?? ""}
              disabled={!isIdentityComplete}
              onValueChange={(value) => {
                if (value !== "emissionAndReception" && value !== "receptionOnly") return;
                setInvoicingChoice(value);
                field.handleChange(value === "emissionAndReception");
              }}
            >
              <Label className="hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-accent/50 flex items-start gap-3 rounded-lg border p-4">
                <Radio value="emissionAndReception" />
                <span className="space-y-1">
                  <span className="block text-sm font-semibold">
                    {t("louezInvoicing.emissionAndReception")}
                  </span>
                  <span className="text-muted-foreground block text-sm font-normal">
                    {t("louezInvoicing.emissionAndReceptionDescription")}
                  </span>
                </span>
              </Label>
              <Label className="hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-accent/50 flex items-start gap-3 rounded-lg border p-4">
                <Radio value="receptionOnly" />
                <span className="space-y-1">
                  <span className="block text-sm font-semibold">
                    {t("louezInvoicing.receptionOnly")}
                  </span>
                  <span className="text-muted-foreground block text-sm font-normal">
                    {t("louezInvoicing.receptionOnlyDescription")}
                  </span>
                </span>
              </Label>
            </RadioGroup>
            <p className="text-muted-foreground text-sm">{t("louezInvoicing.reformTimeline")}</p>
          </div>
        )}
      </form.Field>

      {invoicingEnabled && (
        <div className="space-y-6 border-t pt-6">
          <form.Field name="vatRegime">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor={field.name} data-error={field.state.meta.errors.length > 0}>
                  {t("louezInvoicing.vatRegime")}
                </Label>
                <Select
                  items={vatRegimeValues.map((regime) => ({
                    value: regime,
                    label: t(`louezInvoicing.vatRegimeOptions.${regime}`),
                  }))}
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value)}
                >
                  <SelectTrigger
                    id={field.name}
                    aria-invalid={field.state.meta.errors.length > 0}
                    className="sm:max-w-sm"
                  >
                    <SelectValue placeholder={t("louezInvoicing.vatRegimePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {vatRegimeValues.map((regime) => (
                      <SelectItem key={regime} value={regime}>
                        {t(`louezInvoicing.vatRegimeOptions.${regime}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-sm">
                  {t("louezInvoicing.vatRegimeDescription")}
                </p>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-sm">
                    {getFieldError(field.state.meta.errors[0])}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <form.AppField name="hasVatOnDebits">
            {(field) => (
              <field.Switch
                label={t("louezInvoicing.hasVatOnDebits")}
                description={t("louezInvoicing.hasVatOnDebitsDescription")}
              />
            )}
          </form.AppField>
        </div>
      )}
    </>
  );

  if (mode === "setup") {
    const stepId = INVOICING_SETUP_STEPS[step] ?? "identity";
    const stepHeader = {
      identity: {
        badge: identityBadge,
        description: t("identity.description"),
        title: t("identity.title"),
      },
      activation: {
        badge: activationBadge,
        description: t("louezInvoicing.description"),
        title: t("louezInvoicing.title"),
      },
      transmission: {
        badge: transmissionBadge,
        description: t("transmission.description"),
        title: t("transmission.title"),
      },
    }[stepId];

    const hasStarted = resolveInitialSetupStep(progress) > 0;

    return (
      <>
        <Card>
          <CardContent className="space-y-6">
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold sm:text-lg">{t("setup.intro.title")}</h3>
              <p className="text-muted-foreground text-sm">{t("setup.intro.description")}</p>
            </div>

            <Alert variant="info">
              <CalendarCheckIcon />
              <AlertTitle>{t("transmission.deadlineTitle")}</AlertTitle>
              <AlertDescription>{t("transmission.deadlineDescription")}</AlertDescription>
            </Alert>

            <ul className="space-y-3">
              {introBullets.map(({ icon: Icon, key }) => (
                <li key={key} className="flex items-start gap-3">
                  <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                    <Icon className="size-4" />
                  </span>
                  <span className="text-muted-foreground pt-1.5 text-sm">
                    {t(`setup.intro.bullets.${key}`)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => setWizardOpen(true)}>
                {hasStarted ? t("setup.intro.resume") : t("setup.intro.start")}
              </Button>
              {hasStarted && (
                <span className="text-muted-foreground text-sm">
                  {t("setup.intro.stepProgress", {
                    current: step + 1,
                    total: INVOICING_SETUP_STEPS.length,
                  })}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Dialog open={isWizardOpen} onOpenChange={(open) => setWizardOpen(open)}>
          <DialogPopup className="sm:max-w-4xl">
            <form.AppForm>
              <form.Form className="contents">
                <DialogHeader className="gap-4">
                  <DialogTitle>{t("title")}</DialogTitle>
                  <div
                    role="progressbar"
                    aria-valuemin={1}
                    aria-valuemax={INVOICING_SETUP_STEPS.length}
                    aria-valuenow={step + 1}
                    aria-label={t("setup.intro.stepProgress", {
                      current: step + 1,
                      total: INVOICING_SETUP_STEPS.length,
                    })}
                    className="flex gap-1.5"
                  >
                    {INVOICING_SETUP_STEPS.map((id, index) => (
                      <div
                        key={id}
                        className={cn(
                          "h-1 flex-1 rounded-full transition-colors duration-500",
                          index <= step ? "bg-foreground" : "bg-border",
                        )}
                      />
                    ))}
                  </div>
                </DialogHeader>
                <DialogPanel>
                  <StepContent key={step} direction={direction} className="space-y-6">
                    <div className="space-y-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {stepHeader.title}
                        {stepHeader.badge}
                      </p>
                      <p className="text-muted-foreground text-sm">{stepHeader.description}</p>
                    </div>

                    <RootError error={rootError} />

                    {stepId === "identity" && renderIdentityFields()}

                    {stepId === "activation" && (
                      <>
                        {legalName.trim().length > 0 && (
                          <div className="bg-muted/50 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3">
                            <div className="min-w-0 text-sm">
                              <p className="truncate font-medium">{legalName}</p>
                              <p className="text-muted-foreground">
                                {companyNumberLabel} {companyNumber}
                              </p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => goToStep(0)}
                            >
                              {tCommon("edit")}
                            </Button>
                          </div>
                        )}
                        {renderActivationFields()}
                      </>
                    )}

                    {stepId === "transmission" && transmissionPanel}
                  </StepContent>
                </DialogPanel>
                <DialogFooter>
                  {step > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="sm:mr-auto"
                      disabled={isSaving}
                      onClick={() => goToStep(step - 1)}
                    >
                      {tCommon("back")}
                    </Button>
                  )}
                  {stepId === "identity" && (
                    <Button type="submit" isPending={isSaving}>
                      {t("setup.continue")}
                    </Button>
                  )}
                  {stepId === "activation" && (
                    <Button type="submit" disabled={invoicingChoice === null} isPending={isSaving}>
                      {t("setup.continue")}
                    </Button>
                  )}
                  {stepId === "transmission" && (
                    <Button type="button" variant="outline" onClick={finishSetupLater}>
                      {t("setup.later")}
                    </Button>
                  )}
                </DialogFooter>
              </form.Form>
            </form.AppForm>
          </DialogPopup>
        </Dialog>
      </>
    );
  }

  const overviewTiles: Array<{ badge: ReactNode; id: InvoicingSetupStep }> = [
    { badge: identityBadge, id: "identity" },
    { badge: activationBadge, id: "activation" },
    {
      badge: (
        <>
          {transmissionBadge}
          {sandboxBadge}
        </>
      ),
      id: "transmission",
    },
  ];

  // The full identity form is long and rarely changes: collapse it into a
  // summary once complete, and only expand on demand (or while incomplete).
  const showsIdentityForm = isEditingIdentity || !isIdentityComplete;

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {overviewTiles.map(({ badge, id }) => {
            const Icon = stepIcons[id];
            return (
              <div key={id} className="flex items-center gap-3">
                <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium">{t(`setup.steps.${id}`)}</p>
                  <div className="flex flex-wrap items-center gap-1.5">{badge}</div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Only shown when something is left to do: connect, resume or reconnect. */}
      {!isTransmissionConnected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {t("transmission.title")}
              {transmissionBadge}
            </CardTitle>
            <CardDescription>{t("transmission.description")}</CardDescription>
          </CardHeader>
          <CardContent>{transmissionPanel}</CardContent>
        </Card>
      )}

      <form.AppForm>
        <form.Form className="space-y-4 sm:space-y-6">
          <RootError error={rootError} />

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {t("louezInvoicing.title")}
                {activationBadge}
              </CardTitle>
              <CardDescription>{t("louezInvoicing.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">{renderActivationFields()}</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1.5">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {t("identity.title")}
                    {identityBadge}
                  </CardTitle>
                  <CardDescription>{t("identity.description")}</CardDescription>
                </div>
                {isIdentityComplete && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setIsEditingIdentity((editing) => !editing)}
                  >
                    {showsIdentityForm ? tCommon("close") : tCommon("edit")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {showsIdentityForm ? (
                renderIdentityFields()
              ) : (
                <div className="space-y-1 text-sm">
                  <p className="font-medium">
                    {legalName}
                    {legalForm.trim().length > 0 && (
                      <span className="text-muted-foreground font-normal"> · {legalForm}</span>
                    )}
                  </p>
                  <p className="text-muted-foreground">
                    {companyNumberLabel} {companyNumber}
                    {vatNumber.trim().length > 0 && ` · ${t("identity.vatNumber")} ${vatNumber}`}
                  </p>
                  <p className="text-muted-foreground">
                    {registeredAddress}, {registeredPostalCode} {registeredCity}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <FloatingSaveBar
            isDirty={isDirty}
            isLoading={isSaving}
            onReset={() => {
              setInvoicingChoice(savedInvoicingChoice);
              form.reset();
            }}
          />
        </form.Form>
      </form.AppForm>
    </div>
  );
};
