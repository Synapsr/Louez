"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";

import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  toastManager,
} from "@louez/ui";
import {
  CheckCircleIcon,
  ExternalLinkIcon,
  FastPaymentIcon,
  ReviewSolidIcon,
  SuccessSolidIcon,
  UnlinkIcon,
  WarningIcon,
} from "@louez/ui/icons";

import { apiErrorKey } from "@/lib/orpc/errors";
import { stripeFinancesQueries } from "@/lib/queries/stripe-finances.queries";

import { startStripeOnboarding, getStripeDashboardUrl, disconnectStripe } from "./actions";

interface StripeConnectCardProps {
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean;
  stripeOnboardingComplete: boolean;
}

export function StripeConnectCard({
  stripeAccountId,
  stripeChargesEnabled,
  stripeOnboardingComplete,
}: StripeConnectCardProps) {
  const t = useTranslations("dashboard.settings.payments");
  const tErrors = useTranslations("errors");
  const router = useRouter();

  const [isConnecting, setIsConnecting] = useState(false);
  const syncMutation = useMutation({
    ...stripeFinancesQueries.syncStatus(),
    onSuccess: () => {
      toastManager.add({ title: t("synced"), type: "success" });
      router.refresh();
    },
    onError: (error) => {
      toastManager.add({ title: tErrors(apiErrorKey(error) ?? "generic"), type: "error" });
    },
  });
  const [isOpeningDashboard, setIsOpeningDashboard] = useState(false);

  const isConnected = !!stripeAccountId;
  const isActive = stripeChargesEnabled && stripeOnboardingComplete;

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const result = await startStripeOnboarding();
      if (result.error) {
        toastManager.add({ title: tErrors(result.error.replace("errors.", "")), type: "error" });
      } else if (result.url) {
        window.location.href = result.url;
      }
    } catch {
      toastManager.add({ title: tErrors("generic"), type: "error" });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSync = () => syncMutation.mutate({});

  const handleOpenDashboard = async () => {
    setIsOpeningDashboard(true);
    try {
      const result = await getStripeDashboardUrl();
      if (result.error) {
        toastManager.add({ title: tErrors(result.error.replace("errors.", "")), type: "error" });
      } else if (result.url) {
        window.open(result.url, "_blank");
      }
    } catch {
      toastManager.add({ title: tErrors("generic"), type: "error" });
    } finally {
      setIsOpeningDashboard(false);
    }
  };

  const handleDisconnect = async () => {
    const result = await disconnectStripe();
    if (result.error) {
      toastManager.add({ title: tErrors(result.error.replace("errors.", "")), type: "error" });
    } else {
      toastManager.add({ title: t("disconnected"), type: "success" });
      router.refresh();
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <FastPaymentIcon className="h-5 w-5 shrink-0" />
              {t("stripeConnect")}
            </CardTitle>
            <CardDescription>{t("stripeConnectDescription")}</CardDescription>
          </div>
          {isConnected && (
            <Badge variant={isActive ? "progress" : "expired"}>
              {isActive ? (
                <>
                  <SuccessSolidIcon className="mr-1 h-3 w-3" />
                  {t("status.active")}
                </>
              ) : (
                <>
                  <ReviewSolidIcon className="mr-1 h-3 w-3" />
                  {t("status.incomplete")}
                </>
              )}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!isConnected ? (
          // Not connected state
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("notConnectedDescription")}</p>
            <Button onClick={handleConnect} isPending={isConnecting}>
              {t("connectStripe")}
            </Button>
          </div>
        ) : isActive ? (
          // Connected and active
          <div className="space-y-4">
            <Alert variant="success">
              <CheckCircleIcon />
              <AlertDescription>{t("activeDescription")}</AlertDescription>
            </Alert>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleOpenDashboard}
                isPending={isOpeningDashboard}
              >
                <ExternalLinkIcon className="mr-2 h-4 w-4" />
                {t("openDashboard")}
              </Button>

              <Button variant="outline" onClick={handleSync} isPending={syncMutation.isPending}>
                <RefreshCw data-slot="icon" />
                {t("sync")}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger
                  render={<Button variant="ghost" className="text-destructive" />}
                >
                  <UnlinkIcon className="mr-2 h-4 w-4" />
                  {t("disconnect")}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("disconnectTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>{t("disconnectDescription")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogClose render={<Button variant="outline" />}>
                      {t("cancel")}
                    </AlertDialogClose>
                    <AlertDialogClose
                      render={<Button variant="destructive" />}
                      onClick={handleDisconnect}
                    >
                      {t("disconnect")}
                    </AlertDialogClose>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ) : (
          // Connected but incomplete
          <div className="space-y-4">
            <Alert variant="warning">
              <WarningIcon />
              <AlertDescription>{t("incompleteDescription")}</AlertDescription>
            </Alert>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleConnect} isPending={isConnecting}>
                {t("completeSetup")}
              </Button>

              <Button variant="outline" onClick={handleSync} isPending={syncMutation.isPending}>
                <RefreshCw data-slot="icon" />
                {t("sync")}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger
                  render={<Button variant="ghost" className="text-destructive" />}
                >
                  <UnlinkIcon className="mr-2 h-4 w-4" />
                  {t("disconnect")}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("disconnectTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>{t("disconnectDescription")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogClose render={<Button variant="outline" />}>
                      {t("cancel")}
                    </AlertDialogClose>
                    <AlertDialogClose
                      render={<Button variant="destructive" />}
                      onClick={handleDisconnect}
                    >
                      {t("disconnect")}
                    </AlertDialogClose>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
