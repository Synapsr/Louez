/**
 * An amount a dashboard form sends, as the text the browser gave it,
 * normalised to the plain decimal the payment writes judge
 * (`paymentAmount`, packages/api services/payment-amount.ts), with no
 * conversion to a number and no rounding: "19.999" stays "19.999", and is
 * refused as too precise there.
 *
 * Only the notations an HTML number input yields for a plain decimal are
 * rewritten: surrounding blanks, a leading plus (`+7` → `7`), a leading dot
 * (`.5` → `0.5`, `-.5` → `-0.5`), a trailing dot (`12.` → `12`). Any other
 * text is returned as it is, for the writes to refuse: an exponent (`5e2`),
 * a comma (`1,5`; every amount input is `type="number"`, whose value a
 * browser gives with a dot or not at all), letters.
 *
 * The forms and the actions both apply it: the server judges what the form
 * would have sent. Anything that is not a string is null: the actions refuse
 * it as an invalid amount. The agents' writes (REST, MCP) do not use it:
 * their grammar is `paymentAmount`'s.
 */
export function typedAmount(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) return text;
  const [, sign = "", whole = "", fraction = ""] = match;
  if (whole === "" && fraction === "") return text;
  return `${sign === "-" ? "-" : ""}${whole || "0"}${fraction ? `.${fraction}` : ""}`;
}
