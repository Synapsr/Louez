"use client";

import Link from "next/link";

import { useTranslations } from "next-intl";

import type { NeedsALookDisplay } from "@/lib/inbox/needs-a-look-display";

import { NeedsALookHandleDialog } from "./needs-a-look-handle-dialog";

interface NeedsALookDetailsProps {
  display: NeedsALookDisplay;
  canAcknowledge: boolean;
  pending: boolean;
  onAcknowledge: () => Promise<unknown>;
}

/** What happened and what to do, the references, and "Mark as handled". */
export const NeedsALookDetails = ({
  display,
  canAcknowledge,
  pending,
  onAcknowledge,
}: NeedsALookDetailsProps) => {
  const t = useTranslations("dashboard.needsALook");

  return (
    <div className="ms-13 space-y-3 pe-2 pt-1 pb-3 text-sm sm:ms-14">
      <div className="space-y-1.5">
        {display.sentences.map((sentence) => (
          <p key={sentence.key} className="text-pretty">
            {t(sentence.key, sentence.values)}
          </p>
        ))}
      </div>
      {display.facts.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          {display.facts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-muted-foreground">{t(fact.label)}</dt>
              <dd className="truncate font-mono text-xs leading-5 select-all">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {display.secondary && (
          <Link
            href={display.secondary.href}
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            {t(display.secondary.label)}
          </Link>
        )}
        {canAcknowledge && (
          <NeedsALookHandleDialog
            heldBack={display.heldBack}
            pending={pending}
            onConfirm={onAcknowledge}
          />
        )}
      </div>
    </div>
  );
};
