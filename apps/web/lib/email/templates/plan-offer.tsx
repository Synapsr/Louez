import { Section } from "@react-email/components";
import { BaseLayout } from "./base-layout";
import {
  CtaButton,
  DetailRow,
  EmailHeading,
  EmailText,
  FooterNote,
  stripLabelColon,
  styles,
} from "./components";
import { getEmailTranslations, type EmailLocale } from "../i18n";

interface PlanOfferEmailProps {
  storeName: string;
  primaryColor?: string;
  /** The plan's name: Pro or Ultra. */
  plan: string;
  /** `service`: a commission; `legacy`: per-reservation fees. */
  source: "legacy" | "service";
  period: "current" | "previous";
  /** The month, written out. */
  month: string;
  /** What the store paid Louez that month, formatted. */
  paid: string;
  /** The plan's monthly price excluding VAT, formatted. */
  price: string;
  /** The same with the VAT of the store's country; null where Louez charges none. */
  priceWithVat: string | null;
  savings: string;
  ctaUrl: string;
  locale?: EmailLocale;
}

/**
 * Store-owner notice, sent once: a Louez plan would have cost the store less than what
 * it paid Louez in a month, with the store's own figures (lib/billing/plan-offer.ts).
 */
export function PlanOfferEmail({
  storeName,
  primaryColor,
  plan,
  source,
  period,
  month,
  paid,
  price,
  priceWithVat,
  savings,
  ctaUrl,
  locale = "fr",
}: PlanOfferEmailProps) {
  const t = getEmailTranslations(locale).planOffer;
  const fill = (text: string) =>
    text
      .replace("{storeName}", storeName)
      .replace("{plan}", plan)
      .replace("{paid}", paid)
      .replace("{savings}", savings);
  const body =
    source === "service"
      ? period === "current"
        ? t.bodyCurrentCommission
        : t.bodyPreviousCommission
      : period === "current"
        ? t.bodyCurrentFees
        : t.bodyPreviousFees;
  const planPrice = priceWithVat
    ? t.planPriceWithVat.replace("{price}", price).replace("{priceWithVat}", priceWithVat)
    : t.planPrice.replace("{price}", price);

  return (
    <BaseLayout
      preview={fill(period === "current" ? t.subjectCurrent : t.subjectPrevious)}
      storeName="Louez.io"
      logoUrl={null}
      primaryColor={primaryColor}
      locale={locale}
    >
      <EmailHeading>{fill(t.title)}</EmailHeading>

      <EmailText>{fill(body)}</EmailText>

      <Section style={styles.card}>
        <DetailRow label={stripLabelColon(t.monthLabel)} value={month} />
        <DetailRow label={stripLabelColon(t.paidLabel)} value={paid} />
        <DetailRow label={stripLabelColon(fill(t.planLabel))} value={planPrice} />
        <DetailRow label={stripLabelColon(t.savingsLabel)} value={savings} />
      </Section>

      <CtaButton href={ctaUrl} label={fill(t.cta)} primaryColor={primaryColor} />

      <FooterNote>{t.footer}</FooterNote>
    </BaseLayout>
  );
}

export default PlanOfferEmail;
