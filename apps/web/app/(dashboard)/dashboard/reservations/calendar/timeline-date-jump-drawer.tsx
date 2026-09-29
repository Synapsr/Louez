"use client";

import { useMemo, useState } from "react";

import { addDays, isSameDay, startOfDay, startOfWeek } from "date-fns";
import { resolveFormatLocale } from "@/lib/i18n/format-locale";
import { ArrowRight, CalendarDays, Search, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  Button,
  Calendar,
  Drawer,
  DrawerDescription,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  DrawerTrigger,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@louez/ui";

import { parseTimelineDateQuery } from "./util.timeline-date-query";

interface TimelineDateJumpDrawerProps {
  currentDate: Date;
  onDateChange: (date: Date) => void;
}

export const TimelineDateJumpDrawer = ({
  currentDate,
  onDateChange,
}: TimelineDateJumpDrawerProps) => {
  const locale = useLocale();
  const t = useTranslations("dashboard.calendar.timeline");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(currentDate);
  const [previewedTime, setPreviewedTime] = useState<number | null>(null);

  const language = locale.toLowerCase().split("-")[0] ?? "en";
  const dateLocale = resolveFormatLocale(language).dateFns;
  const parsedDate = useMemo(() => parseTimelineDateQuery(query, locale), [locale, query]);
  const today = startOfDay(new Date());

  // A typed date walks the calendar to itself, so the sheet always shows one
  // answer instead of a suggestion sitting above an unrelated month.
  const parsedTime = parsedDate?.getTime() ?? null;
  if (parsedTime !== previewedTime) {
    setPreviewedTime(parsedTime);
    if (parsedDate) setCalendarMonth(parsedDate);
  }

  const formatDate = (date: Date, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, options).format(date);

  const triggerLabel = formatDate(currentDate, {
    day: "numeric",
    month: "short",
    ...(currentDate.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
  const longDateOptions: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  };
  const currentLabel = formatDate(currentDate, longDateOptions);
  const resultLabel = parsedDate ? formatDate(parsedDate, longDateOptions) : null;
  const calendarBounds = {
    startMonth: new Date(today.getFullYear() - 10, 0),
    endMonth: new Date(today.getFullYear() + 10, 11),
  };
  const quickDates = [
    { label: t("today"), date: today },
    { label: t("tomorrow"), date: addDays(today, 1) },
    {
      label: t("nextWeek"),
      date: startOfWeek(addDays(today, 7), { weekStartsOn: 1 }),
    },
  ];

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) return;

    setQuery("");
    setCalendarMonth(currentDate);
  };

  const handleDateChange = (date: Date) => {
    onDateChange(date);
    setOpen(false);
    setQuery("");
  };

  return (
    <Drawer position="bottom" open={open} onOpenChange={handleOpenChange}>
      <DrawerTrigger
        render={
          <Button
            variant="outline"
            size="default"
            className="max-w-36 min-w-0 capitalize"
            aria-label={`${t("goToDate")}: ${triggerLabel}`}
          />
        }
      >
        <CalendarDays data-slot="icon" />
        <span className="truncate">{triggerLabel}</span>
      </DrawerTrigger>
      <DrawerPopup showCloseButton>
        <DrawerHeader>
          <DrawerTitle>{t("goToDate")}</DrawerTitle>
          {/* The sheet covers the timeline, so it restates where the user is */}
          <DrawerDescription>{t("currentlyViewing", { date: currentLabel })}</DrawerDescription>
        </DrawerHeader>
        <DrawerPanel className="space-y-3 pb-[calc(env(safe-area-inset-bottom,0px)+--spacing(6))]">
          <div className="space-y-2">
            {/* The group zeroes the control's own inline padding, so the gap
                comes from here — otherwise the text sits on the icon. */}
            <InputGroup className="gap-2">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || !parsedDate) return;
                  event.preventDefault();
                  handleDateChange(parsedDate);
                }}
                placeholder={t("dateSearchPlaceholder")}
                aria-label={t("dateSearchPlaceholder")}
                autoComplete="off"
                enterKeyHint="go"
              />
              {query.length > 0 && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={t("clearSearch")}
                    onClick={() => setQuery("")}
                  >
                    <X />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>

            {query.trim() && (
              <div aria-live="polite">
                {parsedDate && resultLabel ? (
                  <Button
                    size="lg"
                    className="w-full justify-between text-sm [&>span]:min-w-0"
                    aria-label={`${t("goToDate")}: ${resultLabel}`}
                    onClick={() => handleDateChange(parsedDate)}
                  >
                    <span className="truncate capitalize">{resultLabel}</span>
                    <ArrowRight data-slot="icon" />
                  </Button>
                ) : (
                  <p className="text-muted-foreground px-1 text-sm">{t("noDateFound")}</p>
                )}
              </div>
            )}
          </div>

          {/* Labelled rather than titled: the shortcuts read fine without a
              heading, and screen readers still get the grouping. */}
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("quickDates")}>
            {quickDates.map((shortcut) => {
              const isCurrent = isSameDay(shortcut.date, currentDate);

              return (
                <Button
                  key={shortcut.label}
                  variant={isCurrent ? "secondary" : "outline"}
                  size="sm"
                  // flex-auto, not flex-1: equal thirds are narrower than the
                  // longest label, which then spills out of its chip.
                  className="min-w-24 flex-auto [&>span]:min-w-0"
                  aria-current={isCurrent ? "date" : undefined}
                  onClick={() => handleDateChange(shortcut.date)}
                >
                  <span className="truncate">{shortcut.label}</span>
                </Button>
              );
            })}
          </div>

          {/* A rule instead of a heading: it splits jumping from browsing
              without adding a line of text to an already tall sheet. */}
          <div role="group" aria-label={t("chooseDate")} className="border-t pt-1">
            <Calendar
              mode="single"
              selected={currentDate}
              month={calendarMonth}
              onMonthChange={setCalendarMonth}
              onSelect={(date) => {
                if (date) handleDateChange(date);
              }}
              locale={dateLocale}
              captionLayout="dropdown"
              startMonth={calendarBounds.startMonth}
              endMonth={calendarBounds.endMonth}
              modifiers={parsedDate ? { preview: parsedDate } : undefined}
              modifiersClassNames={{ preview: "ring-primary/50 rounded-lg ring-2" }}
              // Day cells are square by default, so a full-width grid grows as
              // tall as it is wide. Keeping the width but capping the height
              // gives back ~80px — a six-week month then fits without scrolling.
              className="w-full p-0 [--cell-size:2.25rem] [&_td]:aspect-auto [&_td]:h-(--cell-size) [&_td_button]:aspect-auto [&_td_button]:h-(--cell-size)"
              classNames={{
                root: "w-full",
                month: "flex w-full flex-col gap-2",
                week: "mt-1 flex w-full",
                // A grey box on today reads as a stray hover state next to the
                // filled selection; colouring the number keeps both legible.
                today: "text-primary font-semibold",
              }}
            />
          </div>
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  );
};
