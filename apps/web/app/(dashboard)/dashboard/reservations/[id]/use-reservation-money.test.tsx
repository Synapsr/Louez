import assert from "node:assert/strict";
import test from "node:test";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicEnvProvider } from "@/components/shared/public-env-provider";
import { publicEnvSchema } from "@/lib/validators/validator.public-env";
import { useReservationMoney } from "./use-reservation-money";

// The payment section and its dialogs write each amount through this hook: the
// reservation's currency, with its own decimals, in the user's locale, never
// two decimals and a symbol glued on.

const Amounts = ({ currency, amounts }: { currency: string; amounts: Array<number | string> }) => {
  const money = useReservationMoney(currency);
  return <p>{amounts.map((amount) => money(amount)).join(" | ")}</p>;
};

const render = (locale: string, currency: string, amounts: Array<number | string>) =>
  renderToStaticMarkup(
    <PublicEnvProvider
      config={publicEnvSchema.parse({
        NEXT_PUBLIC_APP_URL: "https://app.louez.io",
        NEXT_PUBLIC_APP_DOMAIN: "louez.io",
      })}
    >
      <NextIntlClientProvider locale={locale} timeZone="Europe/Paris" messages={{}}>
        <Amounts currency={currency} amounts={amounts} />
      </NextIntlClientProvider>
    </PublicEnvProvider>,
  )
    .replace(/<\/?p>/g, "")
    // The French groups and the space before the symbol are no-break spaces.
    .replace(/\s|&nbsp;/g, " ");

test("a currency without decimals is written in whole units, in French", () => {
  assert.equal(render("fr", "JPY", [1500, "3096.00", 1200]), "1 500 JPY | 3 096 JPY | 1 200 JPY");
});

test("a currency with two decimals keeps them, in French", () => {
  assert.equal(render("fr", "EUR", [12, "1234.5", 0]), "12,00 € | 1 234,50 € | 0,00 €");
});

test("the reservation's currency is the one written, whatever the store's", () => {
  assert.equal(render("en", "GBP", [12]), "£12.00");
});
