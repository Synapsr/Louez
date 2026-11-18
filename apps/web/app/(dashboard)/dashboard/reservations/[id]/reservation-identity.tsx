"use client";
import { useTranslations } from "next-intl";
import { Badge } from "@louez/ui";
import type { ComponentProps } from "react";
import {
  ContractSignatureBadge,
  showsContractSignature,
} from "@/components/dashboard/contract-signature-badge";
import { TestBadge } from "@/components/dashboard/test-reservation/test-badge";
import { PaymentStatusBadge } from "./payment-status-badge";
import { STATUS_CONFIG } from "../reservations-utils";

export interface ReservationIdentityProps extends Omit<
  ComponentProps<typeof PaymentStatusBadge>,
  "className" | "showDetails"
> {
  reservationId: string;
  reservationNumber: string;
  status: keyof typeof STATUS_CONFIG;
  contractSignature?: ComponentProps<typeof ContractSignatureBadge>;
}

export const ReservationIdentity = ({
  reservationId,
  reservationNumber,
  status,
  rentalAmount,
  rentalPaid,
  depositAmount,
  depositCollected,
  depositReturned,
  contractSignature,
}: ReservationIdentityProps) => {
  const t = useTranslations("dashboard.reservations");
  return (
    <div className="space-y-1">
      {/* Reservation number + Status badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight">#{reservationNumber}</h1>
        <Badge variant={STATUS_CONFIG[status].badgeVariant} className="font-medium">
          {t(`status.${status}`)}
        </Badge>
        <TestBadge reservationId={reservationId} />
        <PaymentStatusBadge
          rentalAmount={rentalAmount}
          rentalPaid={rentalPaid}
          depositAmount={depositAmount}
          depositCollected={depositCollected}
          depositReturned={depositReturned}
        />
        {contractSignature && showsContractSignature(status, contractSignature.signedAt) && (
          <ContractSignatureBadge {...contractSignature} />
        )}
      </div>
    </div>
  );
};
