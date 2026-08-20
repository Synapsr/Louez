import type { ComponentType, PropsWithChildren } from "react";
import {
  Document as BaseDocument,
  Page as BasePage,
  StyleSheet,
  Text as BaseText,
  View as BaseView,
} from "@react-pdf/renderer";

import type {
  InvoiceBuyerSnapshot,
  InvoiceLineSnapshot,
  InvoiceSellerSnapshot,
  InvoiceVatBreakdownSnapshot,
} from "@louez/types";

import { createContractStyles } from "./styles";
import { getInvoicePdfTranslations, type InvoicePdfLocale } from "./invoice-i18n";

type PdfComponent = ComponentType<PropsWithChildren<Record<string, unknown>>>;
const Document = BaseDocument as unknown as PdfComponent;
const Page = BasePage as unknown as PdfComponent;
const Text = BaseText as unknown as PdfComponent;
const View = BaseView as unknown as PdfComponent;

const invoiceStyles = StyleSheet.create({
  legalLine: { fontSize: 7, color: "#666666", marginTop: 2 },
  lineDescription: { flex: 3.2 },
  lineQuantity: { flex: 0.6, textAlign: "center" },
  lineMoney: { flex: 1.3, textAlign: "right" },
  lineVat: { flex: 0.8, textAlign: "right" },
  vatTable: { marginTop: 12, width: 300, alignSelf: "flex-end" },
  vatReason: { fontSize: 7, color: "#777777", marginTop: 2 },
  paymentBox: {
    marginTop: 14,
    backgroundColor: "#fafafa",
    borderRadius: 4,
    padding: 10,
  },
  paymentRow: { flexDirection: "row", marginBottom: 2 },
  paymentLabel: { width: 125, fontSize: 8, color: "#666666" },
  paymentValue: { flex: 1, fontSize: 8, color: "#333333" },
  legalMentions: {
    marginTop: 18,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: "#eeeeee",
  },
  legalMention: { fontSize: 6.8, color: "#777777", marginBottom: 2, lineHeight: 1.35 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 6.5,
    color: "#999999",
    textAlign: "center",
  },
});

export interface InvoiceDocumentProps {
  type: "invoice" | "credit_note";
  number: string;
  issueDate: string;
  currency: string;
  locale: InvoicePdfLocale;
  primaryColor?: string;
  seller: InvoiceSellerSnapshot;
  buyer: InvoiceBuyerSnapshot;
  lines: InvoiceLineSnapshot[];
  vatBreakdown: InvoiceVatBreakdownSnapshot[];
  totals: { totalExclTax: string; totalTax: string; totalInclTax: string };
  processingRule: "b2b" | "b2c";
  payment: { method: string; paidAt: Date | null; amount: string };
  precedingInvoice?: { number: string; issueDate: string };
}

function formatMoney(value: string, locale: InvoicePdfLocale, currency: string): string {
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-IE", {
    style: "currency",
    currency,
  })
    .format(Number(value))
    .replace(/\u00A0|\u202F/g, " ");
}

function formatDate(value: string | Date, locale: InvoicePdfLocale): string {
  const date = value instanceof Date ? value : new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}

function renderAddressBlock(
  address: InvoiceSellerSnapshot["address"] | InvoiceBuyerSnapshot["address"],
) {
  if (!address) return null;
  return (
    <>
      <Text>{address.address}</Text>
      {address.addressComplement ? <Text>{address.addressComplement}</Text> : null}
      <Text>
        {address.postalCode} {address.city}
      </Text>
      <Text>{address.country}</Text>
    </>
  );
}

export const InvoiceDocument = (props: InvoiceDocumentProps) => {
  const t = getInvoicePdfTranslations(props.locale);
  const styles = createContractStyles(props.primaryColor ?? "#0066FF");
  const sellerRegistration = props.seller.companyNumberScheme === "be_bce" ? "BCE" : "SIREN";
  const buyerName =
    props.buyer.customerType === "business" && props.buyer.companyName
      ? props.buyer.companyName
      : `${props.buyer.firstName} ${props.buyer.lastName}`;

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.headerBar} fixed />
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Text style={styles.storeName}>{props.seller.legalName}</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.documentTypeContainer}>
              <Text style={styles.documentType}>
                {props.type === "invoice" ? t.documentType.invoice : t.documentType.creditNote}
              </Text>
            </View>
            <Text style={styles.documentNumber}>
              {t.labels.number} {props.number}
            </Text>
            <Text style={styles.documentDate}>
              {t.labels.date} {formatDate(props.issueDate, props.locale)}
            </Text>
            {props.precedingInvoice ? (
              <Text style={styles.documentDate}>
                {t.labels.precedingInvoice} {props.precedingInvoice.number} (
                {formatDate(props.precedingInvoice.issueDate, props.locale)})
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.partiesContainer} wrap={false}>
          <View style={styles.partyCard}>
            <Text style={styles.partyLabel}>{t.labels.seller}</Text>
            <Text style={styles.partyName}>
              {props.seller.legalName} — {props.seller.legalForm}
            </Text>
            {renderAddressBlock(props.seller.address)}
            {props.seller.email ? <Text style={styles.partyInfo}>{props.seller.email}</Text> : null}
            {props.seller.phone ? <Text style={styles.partyInfo}>{props.seller.phone}</Text> : null}
            <Text style={invoiceStyles.legalLine}>
              {sellerRegistration} : {props.seller.companyNumber}
            </Text>
            {props.seller.siret ? (
              <Text style={invoiceStyles.legalLine}>
                {t.labels.siret} : {props.seller.siret}
              </Text>
            ) : null}
            {props.seller.rcsCity ? (
              <Text style={invoiceStyles.legalLine}>
                {t.labels.rcs} {props.seller.rcsCity}
              </Text>
            ) : null}
            {props.seller.shareCapital ? (
              <Text style={invoiceStyles.legalLine}>
                {t.labels.shareCapital} :{" "}
                {formatMoney(props.seller.shareCapital, props.locale, props.currency)}
              </Text>
            ) : null}
            {props.seller.vatNumber ? (
              <Text style={invoiceStyles.legalLine}>
                {t.labels.vatNumber} : {props.seller.vatNumber}
              </Text>
            ) : null}
          </View>
          <View style={styles.partyCard}>
            <Text style={styles.partyLabel}>{t.labels.buyer}</Text>
            <Text style={styles.partyName}>{buyerName}</Text>
            {props.buyer.customerType === "business" && props.buyer.companyName ? (
              <Text style={styles.partyInfo}>
                {t.labels.contact} : {props.buyer.firstName} {props.buyer.lastName}
              </Text>
            ) : null}
            {renderAddressBlock(props.buyer.address)}
            <Text style={styles.partyInfo}>{props.buyer.email}</Text>
            {props.buyer.phone ? <Text style={styles.partyInfo}>{props.buyer.phone}</Text> : null}
            {props.buyer.companyNumber ? (
              <Text style={invoiceStyles.legalLine}>
                {t.labels.companyNumber} : {props.buyer.companyNumber}
              </Text>
            ) : null}
            {props.buyer.vatNumber ? (
              <Text style={invoiceStyles.legalLine}>
                {t.labels.vatNumber} : {props.buyer.vatNumber}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.tableSection} wrap={false}>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, invoiceStyles.lineDescription]}>
                {t.table.description}
              </Text>
              <Text style={[styles.tableHeaderCell, invoiceStyles.lineQuantity]}>
                {t.table.quantity}
              </Text>
              <Text style={[styles.tableHeaderCell, invoiceStyles.lineMoney]}>
                {t.table.unitPriceExclTax}
              </Text>
              <Text style={[styles.tableHeaderCell, invoiceStyles.lineVat]}>{t.table.vatRate}</Text>
              <Text style={[styles.tableHeaderCell, invoiceStyles.lineMoney]}>
                {t.table.totalExclTax}
              </Text>
            </View>
            {props.lines.map((line, index) => (
              <View
                key={line.id}
                style={[styles.tableRow, index % 2 === 1 ? styles.tableRowAlt : {}]}
              >
                <Text style={[styles.tableCell, invoiceStyles.lineDescription]}>
                  {line.description}
                </Text>
                <Text style={[styles.tableCell, invoiceStyles.lineQuantity]}>{line.quantity}</Text>
                <Text style={[styles.tableCell, invoiceStyles.lineMoney]}>
                  {formatMoney(line.unitPriceExclTax, props.locale, props.currency)}
                </Text>
                <Text style={[styles.tableCell, invoiceStyles.lineVat]}>{line.taxRate} %</Text>
                <Text style={[styles.tableCell, invoiceStyles.lineMoney]}>
                  {formatMoney(line.totalExclTax, props.locale, props.currency)}
                </Text>
              </View>
            ))}
          </View>

          <View style={invoiceStyles.vatTable}>
            <Text style={styles.sectionTitle}>{t.vat.title}</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, invoiceStyles.lineVat]}>{t.vat.rate}</Text>
                <Text style={[styles.tableHeaderCell, invoiceStyles.lineMoney]}>
                  {t.vat.taxableAmount}
                </Text>
                <Text style={[styles.tableHeaderCell, invoiceStyles.lineMoney]}>
                  {t.vat.taxAmount}
                </Text>
              </View>
              {props.vatBreakdown.map((entry) => (
                <View
                  key={`${entry.taxRate}:${entry.exemptionReason ?? "standard"}`}
                  style={styles.tableRow}
                >
                  <Text style={[styles.tableCell, invoiceStyles.lineVat]}>{entry.taxRate} %</Text>
                  <Text style={[styles.tableCell, invoiceStyles.lineMoney]}>
                    {formatMoney(entry.taxableAmount, props.locale, props.currency)}
                  </Text>
                  <Text style={[styles.tableCell, invoiceStyles.lineMoney]}>
                    {formatMoney(entry.taxAmount, props.locale, props.currency)}
                  </Text>
                </View>
              ))}
            </View>
            {props.vatBreakdown.map((entry) =>
              entry.exemptionReason ? (
                <Text
                  key={`reason:${entry.taxRate}:${entry.exemptionReason}`}
                  style={invoiceStyles.vatReason}
                >
                  {entry.exemptionReason}
                </Text>
              ) : null,
            )}
          </View>

          <View style={styles.totalsContainer}>
            <View style={styles.totalsBox}>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{t.totals.exclTax}</Text>
                <Text style={styles.totalValue}>
                  {formatMoney(props.totals.totalExclTax, props.locale, props.currency)}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{t.totals.tax}</Text>
                <Text style={styles.totalValue}>
                  {formatMoney(props.totals.totalTax, props.locale, props.currency)}
                </Text>
              </View>
              <View style={[styles.totalRow, styles.totalRowMain]}>
                <Text style={styles.totalLabelMain}>{t.totals.inclTax}</Text>
                <Text style={styles.totalValueMain}>
                  {formatMoney(props.totals.totalInclTax, props.locale, props.currency)}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={invoiceStyles.paymentBox} wrap={false}>
          <Text style={styles.sectionTitle}>{t.labels.payment}</Text>
          <View style={invoiceStyles.paymentRow}>
            <Text style={invoiceStyles.paymentLabel}>{t.labels.paymentDate}</Text>
            <Text style={invoiceStyles.paymentValue}>
              {props.payment.paidAt
                ? formatDate(props.payment.paidAt, props.locale)
                : formatDate(props.issueDate, props.locale)}
            </Text>
          </View>
          <View style={invoiceStyles.paymentRow}>
            <Text style={invoiceStyles.paymentLabel}>{t.labels.paymentMethod}</Text>
            <Text style={invoiceStyles.paymentValue}>
              {t.methods[props.payment.method] ?? props.payment.method}
            </Text>
          </View>
          <View style={invoiceStyles.paymentRow}>
            <Text style={invoiceStyles.paymentLabel}>{t.totals.inclTax}</Text>
            <Text style={invoiceStyles.paymentValue}>
              {formatMoney(props.payment.amount, props.locale, props.currency)}
            </Text>
          </View>
        </View>

        <View style={invoiceStyles.legalMentions} wrap={false}>
          <Text style={invoiceStyles.legalMention}>
            Pénalités de retard : taux égal à trois fois le taux d'intérêt légal, exigibles sans
            rappel.
          </Text>
          {props.processingRule === "b2b" ? (
            <Text style={invoiceStyles.legalMention}>
              Indemnité forfaitaire de 40 EUR pour frais de recouvrement due en cas de retard de
              paiement.
            </Text>
          ) : null}
          <Text style={invoiceStyles.legalMention}>Escompte pour paiement anticipé : néant.</Text>
        </View>

        <Text style={invoiceStyles.footer} fixed>
          {props.seller.legalName} — {props.number}
        </Text>
      </Page>
    </Document>
  );
};
