import { useFormatter, useLocale, useTranslations } from "next-intl";

import type { ShownDisplay } from "@louez/api/services/approval-page";

import { displayArguments, type DisplayFormat } from "@/lib/handoffs/util.approval-display";

interface ApprovalDisplayProps {
  display: ShownDisplay;
  /** The time zone the store's dates are written in. */
  timeZone: string;
}

/**
 * What a person reads first of an agent's request: Louez's headline, in the
 * person's language, then a short list of facts, each one line of Louez's
 * words around values from the store's records. Each value is set apart as
 * data: its own isolated run of text (`bdi`), so a name written like a
 * sentence, or in another direction, stays inside its value; each fact's
 * box clips what a value would draw past it, and a long name breaks only
 * when nothing else can, so a phone's narrow screen never scrolls sideways.
 */
export const ApprovalDisplay = ({ display, timeZone }: ApprovalDisplayProps) => {
  const t = useTranslations("handoff.operation_approval.display");
  const format = useFormatter();
  const locale = useLocale();
  const formatting: DisplayFormat = {
    locale,
    timeZone,
    number: (value, options) => format.number(value, options),
    dateTime: (value, options) => format.dateTime(value, options),
    choice: (list, value) => t(`choices.${list}.${value}`),
  };

  return (
    <div className="min-w-0 space-y-2">
      <p className="text-foreground text-base leading-snug font-semibold wrap-break-word">
        {t(`headline.${display.headline.key}`)}
      </p>
      <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm leading-relaxed">
        {display.facts.map((line, index) => (
          <li
            key={`${line.key}-${index}`}
            className="min-w-0 overflow-hidden wrap-break-word"
          >
            {t.rich(`facts.${line.key}`, {
              ...displayArguments(line.values, formatting),
              v: (chunks) => <bdi className="text-foreground font-medium">{chunks}</bdi>,
            })}
          </li>
        ))}
      </ul>
    </div>
  );
};
