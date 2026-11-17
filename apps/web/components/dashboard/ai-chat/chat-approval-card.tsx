"use client";

import { useEffect, useRef, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { CheckIcon, ClockIcon, ExternalLinkIcon } from "@louez/ui/icons";

import {
  APPROVAL_CARD_POLL_MS,
  approvalCardState,
  approvalCardWaits,
  createFocusRead,
  approvalPagePath,
  type ApprovalCard,
} from "@/lib/ai/approval-card";
import { orpc } from "@/lib/orpc/react";

interface ChatApprovalCardProps {
  card: ApprovalCard;
  /** Sends the turn that lets the assistant carry out what the person approved (`continueApproval`). */
  onContinue: (card: ApprovalCard, options?: { manual?: boolean }) => void;
}

/**
 * A payment the assistant prepared, waiting for the person: what it is, in
 * a glance (the summary Louez stored, the amount, the booking), and one
 * button to the approval's page, in a new tab, where they decide with
 * everything Louez checked. The card decides nothing. It reads where the
 * request stands with the person's own session (`handoffs.get`) at most
 * every `APPROVAL_CARD_POLL_MS` while it waits, the tab coming back to the
 * front included; a passing failure keeps what it last read and reads again
 * at that interval, and one for good stops it (`unavailable`). Once
 * approved, the chat goes on by itself (`onContinue`), and "Continue" sends
 * that turn again.
 */
export const ChatApprovalCard = ({ card, onContinue }: ChatApprovalCardProps) => {
  const t = useTranslations("dashboard.aiChat.approval");
  const format = useFormatter();
  const { data, error, dataUpdatedAt, errorUpdatedAt, refetch } = useQuery(
    orpc.dashboard.handoffs.get.queryOptions({
      input: { id: card.approvalId },
      // The tab's return is read below, no more often than the interval.
      refetchOnWindowFocus: false,
      refetchInterval: (query) =>
        approvalCardWaits(approvalCardState(query.state)) ? APPROVAL_CARD_POLL_MS : false,
      retry: false,
    }),
  );
  const status = approvalCardState({ data, error });
  const waits = approvalCardWaits(status);
  const lastReadAt = useRef(0);
  lastReadAt.current = Math.max(dataUpdatedAt, errorUpdatedAt);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  // One read at a time on the tab's return, gated when it starts; a read in
  // flight is reused, never cancelled and started again.
  const [focusRead] = useState(() =>
    createFocusRead({
      now: Date.now,
      lastReadAt: () => lastReadAt.current,
      read: () => refetchRef.current({ cancelRefetch: false }),
    }),
  );

  useEffect(() => {
    if (!waits) return;
    const onReturn = () => {
      if (document.visibilityState === "visible") void focusRead();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [waits, focusRead]);

  useEffect(() => {
    if (status === "approved") onContinue(card);
  }, [status, card, onContinue]);

  return (
    <div className="border-border bg-card my-2 max-w-md space-y-3 rounded-xl border p-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold">{t(`title.${card.tool}`)}</p>
        <p className="text-muted-foreground text-xs wrap-break-word">
          <bdi>{card.summary}</bdi>
        </p>
      </div>

      {(card.amount || card.bookingNumber) && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {card.amount && (
            <div>
              <dt className="text-muted-foreground text-xs">{t("amount")}</dt>
              <dd className="font-medium tabular-nums">{card.amount}</dd>
            </div>
          )}
          {card.bookingNumber && (
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">{t("booking")}</dt>
              <dd className="truncate font-medium">
                <bdi>{card.bookingNumber}</bdi>
              </dd>
            </div>
          )}
        </dl>
      )}

      {status === "pending" ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            render={
              <a
                href={approvalPagePath(card.approvalId)}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            {t("open")}
            <ExternalLinkIcon data-slot="icon" />
          </Button>
          {card.expiresAt && (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <ClockIcon aria-hidden className="size-3.5" />
              {t("expires", {
                when: format.dateTime(card.expiresAt, { dateStyle: "short", timeStyle: "short" }),
              })}
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="inline-flex items-center gap-1.5 text-sm">
            {(status === "approved" || status === "completed") && (
              <CheckIcon aria-hidden className="size-4 shrink-0" />
            )}
            {t(`status.${status}`)}
          </p>
          {status === "approved" && (
            <Button variant="outline" size="sm" onClick={() => onContinue(card, { manual: true })}>
              {t("continue")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
