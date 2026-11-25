"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Handshake, X } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toastManager,
} from "@louez/ui";
import { formatCurrency } from "@louez/utils";

import { useStoreHasPermission } from "@/contexts/store-context";
import { apiErrorKey } from "@/lib/orpc/errors";
import { partnersMutations, partnersQueries } from "@/lib/queries/partners.queries";

import { PartnersReadOnlyNotice } from "./partners-read-only-notice";
import { usePartnersAnalytics } from "./use-partners-analytics";

interface ReservationPartnerCardProps {
  storeId: string;
  reservationId: string;
}

/**
 * The partner a reservation is credited to, on its page: who, how (link or by
 * hand) and the commission; the store attributes, changes or removes it. Not
 * shown for a store without partners.
 */
export const ReservationPartnerCard = ({ storeId, reservationId }: ReservationPartnerCardProps) => {
  const t = useTranslations("dashboard.partners.reservation");
  const tStates = useTranslations("dashboard.partners.statement.states");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const analytics = usePartnersAnalytics(storeId);
  const canManage = useStoreHasPermission("manage_settings");
  const { data } = useQuery(partnersQueries.forReservation(reservationId));
  const setPartner = useMutation({
    ...partnersMutations.setForReservation(),
    onSuccess: (_result, input) => {
      analytics.reservationChanged(input.partnerId ? "attributed" : "removed");
      void queryClient.invalidateQueries({ queryKey: partnersQueries.key() });
    },
    onError: (error) => {
      const key = apiErrorKey(error);
      toastManager.add({
        title: key && tErrors.has(key) ? tErrors(key) : tErrors("generic"),
        type: "error",
      });
    },
  });

  if (!data || (!data.current && data.options.length === 0)) return null;
  const { current, options, currency } = data;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Handshake className="h-4 w-4" />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {current && (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{current.name}</p>
              <p className="text-muted-foreground text-sm">
                {t(`origin.${current.origin}`)} ·{" "}
                {t("commission", {
                  amount: formatCurrency(current.commission, currency),
                  state: tStates(current.state),
                })}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={t("remove")}
              disabled={!canManage || setPartner.isPending}
              onClick={() => setPartner.mutate({ reservationId, partnerId: null })}
            >
              <X className="size-4" />
            </Button>
          </div>
        )}
        {options.length > 0 && (
          <Select
            value={current?.partnerId ?? null}
            items={options.map((option) => ({ value: option.id, label: option.name }))}
            onValueChange={(partnerId) => {
              if (partnerId && partnerId !== current?.partnerId) {
                setPartner.mutate({ reservationId, partnerId });
              }
            }}
          >
            <SelectTrigger disabled={!canManage || setPartner.isPending}>
              <SelectValue placeholder={current ? t("change") : t("attribute")} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {!canManage && <PartnersReadOnlyNotice />}
      </CardContent>
    </Card>
  );
};
