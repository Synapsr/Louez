import { MIN_PASSWORD_LENGTH } from "@louez/auth/password-policy";

/** Key of the rule's label under the `auth.passwordRules` namespace. */
export type PasswordRuleId = "minLength";

export interface PasswordRuleState {
  id: PasswordRuleId;
  met: boolean;
}

/** Rules a new password must meet, in display order, checked as the user types. */
export const evaluatePasswordRules = (password: string): PasswordRuleState[] => [
  { id: "minLength", met: password.length >= MIN_PASSWORD_LENGTH },
];
