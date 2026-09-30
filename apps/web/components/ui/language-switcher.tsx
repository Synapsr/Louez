"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useState, useEffect } from "react";
import { locales, localeCountries, localeNames, Locale } from "@/i18n/config";
import { cn } from "@louez/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@louez/ui";
import { Button } from "@louez/ui";
import { CheckIcon, GlobeIcon } from "@louez/ui/icons";
import { CountryFlag } from "@louez/ui/icons/flags";
import { useTranslations } from "next-intl";

interface LanguageSwitcherProps {
  variant?: "default" | "compact" | "minimal";
  className?: string;
}

function LanguageFlag({ locale }: { locale: Locale }) {
  return (
    <CountryFlag
      country={localeCountries[locale]}
      countryName={localeNames[locale]}
      className="h-4 w-6 shrink-0 [&_img]:size-full [&_svg]:size-full"
    />
  );
}

function setLocaleCookie(locale: Locale) {
  document.cookie = `NEXT_LOCALE=${locale};path=/;max-age=31536000;samesite=lax`;
}

export function LanguageSwitcher({ variant = "default", className }: LanguageSwitcherProps) {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleLocaleChange = (newLocale: Locale) => {
    if (newLocale === locale) return;
    setLocaleCookie(newLocale);
    router.refresh();
  };

  if (variant === "minimal") {
    return (
      <div className={cn("flex flex-wrap items-center gap-1", className)}>
        {locales.map((loc) => (
          <button
            key={loc}
            aria-label={localeNames[loc]}
            aria-pressed={locale === loc}
            onClick={() => handleLocaleChange(loc)}
            className={cn(
              "px-2 py-1 text-sm rounded transition-colors",
              locale === loc
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            <LanguageFlag locale={loc} />
          </button>
        ))}
      </div>
    );
  }

  if (variant === "compact") {
    if (!mounted) {
      return (
        <Button variant="ghost" className={cn("gap-2", className)}>
          <LanguageFlag locale={locale} />
          <span className="text-xs uppercase">{locale}</span>
        </Button>
      );
    }
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" className={cn("gap-2", className)} />}>
          <LanguageFlag locale={locale} />
          <span className="text-xs uppercase">{locale}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {locales.map((loc) => (
            <DropdownMenuItem
              key={loc}
              onClick={() => handleLocaleChange(loc)}
              className={cn("gap-2 cursor-pointer", locale === loc && "bg-accent")}
            >
              <LanguageFlag locale={loc} />
              <span>{localeNames[loc]}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (!mounted) {
    return (
      <Button variant="outline" className={cn("gap-2 w-full justify-start", className)}>
        <GlobeIcon className="h-4 w-4" />
        <LanguageFlag locale={locale} />
        <span className="flex-1 text-left">{localeNames[locale]}</span>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" className={cn("gap-2 w-full justify-start", className)} />
        }
      >
        <GlobeIcon className="h-4 w-4" />
        <LanguageFlag locale={locale} />
        <span className="flex-1 text-left">{localeNames[locale]}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
        {locales.map((loc) => (
          <DropdownMenuItem
            key={loc}
            aria-label={localeNames[loc]}
            aria-pressed={locale === loc}
            onClick={() => handleLocaleChange(loc)}
            className={cn("gap-2 cursor-pointer", locale === loc && "bg-accent")}
          >
            <LanguageFlag locale={loc} />
            <span>{localeNames[loc]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LanguageMenuSub() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const t = useTranslations("common.language");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleLocaleChange = (newLocale: Locale) => {
    if (newLocale === locale) return;
    setLocaleCookie(newLocale);
    router.refresh();
  };

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <GlobeIcon className="h-4 w-4" />
        {t("label")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-48">
        {locales.map((loc) => (
          <DropdownMenuItem
            key={loc}
            aria-label={localeNames[loc]}
            aria-pressed={locale === loc}
            onClick={() => handleLocaleChange(loc)}
            className="cursor-pointer"
          >
            <LanguageFlag locale={loc} />
            <span>{localeNames[loc]}</span>
            {mounted && locale === loc && <CheckIcon className="ml-auto h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
