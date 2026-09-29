"use client";

import { Circle } from "lucide-react";
import { useTranslations } from "next-intl";

import { MIN_PASSWORD_LENGTH } from "@louez/auth/password-policy";
import { CheckCircleIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { evaluatePasswordRules } from "./util.password-rules";

interface PasswordRulesChecklistProps {
  password: string;
}

/** Live checklist under a new-password field: each rule ticks as it is met. */
export const PasswordRulesChecklist = ({ password }: PasswordRulesChecklistProps) => {
  const t = useTranslations("auth.passwordRules");

  return (
    <ul className="space-y-1" aria-live="polite">
      {evaluatePasswordRules(password).map((rule) => (
        <li
          key={rule.id}
          className={cn(
            "flex items-center gap-2 text-sm transition-colors",
            rule.met ? "text-success" : "text-muted-foreground",
          )}
        >
          {rule.met ? (
            <CheckCircleIcon className="size-4 shrink-0" />
          ) : (
            <Circle className="size-4 shrink-0" />
          )}
          {t(rule.id, { count: MIN_PASSWORD_LENGTH })}
        </li>
      ))}
    </ul>
  );
};
