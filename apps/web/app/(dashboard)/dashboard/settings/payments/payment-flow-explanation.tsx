"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Lightbulb } from "lucide-react";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@louez/ui";
import {
  CheckCircleIcon,
  ClockIcon,
  CreditCardIcon,
  CreditCardSolidIcon,
  FastPaymentIcon,
  FileCheckIcon,
  FileCheckSolidIcon,
  MailIcon,
  ReviewSolidIcon,
  WarningIcon,
  ZapSolidIcon,
} from "@louez/ui/icons";

import { FlowStep } from "./flow-step";
import { useStepAnimation } from "./use-step-animation";

interface PaymentFlowExplanationProps {
  reservationMode: "payment" | "request";
  stripeChargesEnabled: boolean;
  onConnectStripe?: () => Promise<void>;
  isConnecting?: boolean;
}

export const PaymentFlowExplanation = ({
  reservationMode,
  stripeChargesEnabled,
  onConnectStripe,
  isConnecting = false,
}: PaymentFlowExplanationProps) => {
  const t = useTranslations("dashboard.settings.payments.flowExplanation");

  // Determine the current scenario
  const isRequestMode = reservationMode === "request";
  const hasStripe = stripeChargesEnabled;

  // Animation: cycle through steps every 2 seconds (only rendered pre-Stripe)
  const activeStep = useStepAnimation(4, 2000);

  // Scenario: Stripe connected. The full walkthrough has done its onboarding
  // job, so shrink to a summary and keep only the actionable nudge.
  if (hasStripe) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                {isRequestMode ? (
                  <ClockIcon className="h-5 w-5 shrink-0 text-primary" />
                ) : (
                  <FastPaymentIcon className="h-5 w-5 shrink-0 text-primary" />
                )}
                {t("title")}
              </CardTitle>
              <CardDescription>
                {isRequestMode ? t("info.requestWithStripe") : t("info.instantPayment")}
              </CardDescription>
            </div>
            <div className="flex shrink-0 gap-2">
              {isRequestMode ? (
                <Badge variant="expired" className="gap-1">
                  <FileCheckSolidIcon className="h-3 w-3" />
                  {t("modes.request")}
                </Badge>
              ) : (
                <Badge variant="progress" className="gap-1">
                  <ZapSolidIcon className="h-3 w-3" />
                  {t("modes.instant")}
                </Badge>
              )}
              <Badge variant="progress" className="gap-1">
                <CreditCardSolidIcon className="h-3 w-3" />
                {t("modes.stripeActive")}
              </Badge>
            </div>
          </div>
        </CardHeader>
        {isRequestMode && (
          <CardContent>
            <Alert variant="info">
              <Lightbulb />
              <AlertTitle>{t("suggestions.instantPayment.title")}</AlertTitle>
              <AlertDescription>{t("suggestions.instantPayment.description")}</AlertDescription>
              <AlertAction>
                <Button variant="outline" render={<Link href="/dashboard/settings" />}>
                  {t("suggestions.instantPayment.action")}
                </Button>
              </AlertAction>
            </Alert>
          </CardContent>
        )}
      </Card>
    );
  }

  // Scenario: Request mode without Stripe
  if (isRequestMode) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <ClockIcon className="h-5 w-5 shrink-0 text-primary" />
                {t("title")}
              </CardTitle>
              <CardDescription>{t("subtitle")}</CardDescription>
            </div>
            <Badge variant="expired" className="gap-1">
              <FileCheckSolidIcon className="h-3 w-3" />
              {t("modes.request")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current flow */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">{t("currentFlow")}</h4>
            <div className="flex flex-col gap-2">
              <FlowStep
                number={1}
                icon={FileCheckIcon}
                text={t("steps.requestSubmitted")}
                isActive={activeStep === 1}
              />
              <FlowStep
                number={2}
                icon={MailIcon}
                text={t("steps.youReview")}
                isActive={activeStep === 2}
              />
              <FlowStep
                number={3}
                icon={CheckCircleIcon}
                text={t("steps.acceptOrReject")}
                isActive={activeStep === 3}
              />
              <FlowStep
                number={4}
                icon={CreditCardIcon}
                text={t("steps.paymentOnSite")}
                isActive={activeStep === 4}
              />
            </div>
          </div>

          {/* Suggestion */}
          <Alert variant="info">
            <Lightbulb />
            <AlertTitle>{t("suggestions.enableStripe.title")}</AlertTitle>
            <AlertDescription>{t("suggestions.enableStripe.description")}</AlertDescription>
            {onConnectStripe && (
              <AlertAction>
                <Button onClick={onConnectStripe} isPending={isConnecting}>
                  {t("suggestions.enableStripe.action")}
                </Button>
              </AlertAction>
            )}
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Scenario: Payment mode without Stripe (should not happen, but handle it)
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <WarningIcon className="h-5 w-5 shrink-0 text-destructive" />
              {t("title")}
            </CardTitle>
            <CardDescription>{t("subtitle")}</CardDescription>
          </div>
          <Badge variant="failed" className="gap-1">
            <ReviewSolidIcon className="h-3 w-3" />
            {t("modes.configRequired")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Warning */}
        <Alert variant="error">
          <WarningIcon />
          <AlertTitle>{t("warnings.noStripeWithPayment.title")}</AlertTitle>
          <AlertDescription>{t("warnings.noStripeWithPayment.description")}</AlertDescription>
          {onConnectStripe && (
            <AlertAction>
              <Button onClick={onConnectStripe} isPending={isConnecting}>
                {t("suggestions.enableStripe.action")}
              </Button>
            </AlertAction>
          )}
        </Alert>
      </CardContent>
    </Card>
  );
};
