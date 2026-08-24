import type {
  InvoiceBuyerSnapshot,
  InvoiceCompanyNumberScheme,
  InvoiceLineSnapshot,
  InvoiceSellerSnapshot,
  InvoiceVatBreakdownSnapshot,
} from "@louez/types";

export type InvoiceSeries = "invoice" | "credit_note";

type TaxDisplayMode = "inclusive" | "exclusive";

interface SnapshotReservation {
  deliveryFee: string | null;
  discountAmount: string | null;
  subtotalExclTax: string | null;
  taxAmount: string | null;
  tulipInsuranceAmount: string | null;
}

interface SnapshotItem {
  id: string;
  productId: string | null;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  taxRate: string | null;
  taxAmount: string | null;
  priceExclTax: string | null;
  totalExclTax: string | null;
  productSnapshot: { name: string };
}

interface SnapshotStore {
  email: string | null;
  phone: string | null;
  settings: {
    tax?: {
      enabled: boolean;
      displayMode: TaxDisplayMode;
      defaultRate: number;
    };
  } | null;
}

interface SnapshotLegalProfile {
  legalName: string;
  legalForm: string;
  companyNumber: string;
  companyNumberScheme: InvoiceCompanyNumberScheme | null;
  siret: string | null;
  vatNumber: string | null;
  rcsCity: string | null;
  shareCapital: string | null;
  registeredAddress: string;
  registeredAddressComplement: string | null;
  registeredPostalCode: string;
  registeredCity: string;
  country: string;
}

interface SnapshotCustomer {
  customerType: "individual" | "business";
  firstName: string;
  lastName: string;
  companyName: string | null;
  companyNumber: string | null;
  companyNumberScheme: InvoiceCompanyNumberScheme | null;
  vatNumber: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  email: string;
  phone: string | null;
}

export interface BuildInvoiceSnapshotsSource {
  reservation: SnapshotReservation;
  items: SnapshotItem[];
  store: SnapshotStore;
  legalProfile: SnapshotLegalProfile;
  customer: SnapshotCustomer;
}

export interface BuildInvoiceSnapshotsAmounts {
  number: string;
  issueDate: string;
  type: InvoiceSeries;
  currency: string;
  amountInclTax: string;
  /**
   * Post-return charge (damage, deposit capture, adjustment): the invoice
   * carries one dedicated line for the charge instead of pro-rata slices of
   * the rental lines, which would misdescribe the supply.
   */
  chargeKind?: "damage" | "adjustment" | "deposit_capture";
  precedingInvoice?: { number: string; issueDate: string };
}

interface En16931ElectronicAddress {
  scheme: "0225" | "0208" | "EM";
  value: string;
}

interface En16931PostalAddress {
  address_line1?: string;
  address_line2?: string;
  post_code?: string;
  city?: string;
  country_code: string;
}

interface En16931Party {
  name: string;
  electronic_address: En16931ElectronicAddress;
  postal_address: En16931PostalAddress;
  legal_registration_identifier?: { scheme: string; value: string };
  vat_identifier?: string;
}

interface En16931Line {
  identifier: string;
  invoiced_quantity: string;
  invoiced_quantity_code: "C62";
  net_amount: string;
  price_details: {
    item_net_price: string;
    item_price_base_quantity: "1";
    quantity_unit_code: "C62";
  };
  item_information: { name: string };
  vat_information: {
    invoiced_item_vat_category_code: "S" | "E";
    invoiced_item_vat_rate: string;
    exemption_reason?: string;
  };
}

interface En16931VatBreakdown {
  vat_category_code: "S" | "E";
  vat_category_rate: string;
  vat_category_taxable_amount: string;
  vat_category_tax_amount: string;
  vat_exemption_reason?: string;
}

export type En16931Invoice = {
  number: string;
  issue_date: string;
  payment_due_date: string;
  delivery_information?: { delivery_date: string };
  type_code: 380 | 381;
  currency_code: string;
  process_control: {
    specification_identifier: string;
    business_process_type: string;
  };
  seller: En16931Party;
  buyer: En16931Party;
  totals: {
    sum_invoice_lines_amount: string;
    total_without_vat: string;
    total_vat_amount: { currency_code: string; value: string };
    total_with_vat: string;
    amount_due_for_payment: string;
  };
  vat_break_down: En16931VatBreakdown[];
  lines: En16931Line[];
  notes?: { subject_code: "BAR" | "REG" | "PMD" | "PMT" | "AAB"; note: string }[];
  preceding_invoice_references?: {
    reference: string;
    issue_date: string;
    preceding_invoice_type_code: 380;
  }[];
};

export interface BuiltInvoiceSnapshots {
  seller: InvoiceSellerSnapshot;
  buyer: InvoiceBuyerSnapshot;
  lines: InvoiceLineSnapshot[];
  vatBreakdown: InvoiceVatBreakdownSnapshot[];
  totals: {
    totalExclTax: string;
    totalTax: string;
    totalInclTax: string;
  };
  processingRule: "b2b" | "b2c";
  en16931: En16931Invoice;
}

const VAT_EXEMPTION_293_B = "TVA non applicable, art. 293 B du CGI";
const INSURANCE_VAT_EXEMPTION = "Exonération de TVA — art. 261 C, 2° du CGI";

function toCents(value: string | number | null | undefined): number {
  const amount = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

function fromCents(value: number): string {
  return (value / 100).toFixed(2);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function sumLineCents(
  lines: InvoiceLineSnapshot[],
  field: "totalExclTax" | "taxAmount" | "totalInclTax",
): number {
  return lines.reduce((total, line) => total + toCents(line[field]), 0);
}

function getPositiveAdjustmentIndex(lines: InvoiceLineSnapshot[]): number {
  for (let index = lines.length - 1; index >= 0; index--) {
    if (toCents(lines[index].totalInclTax) > 0) return index;
  }
  return Math.max(0, lines.length - 1);
}

export function formatInvoiceNumber(series: InvoiceSeries, year: number, sequence: number): string {
  const prefix = series === "invoice" ? "F" : "AV";
  return `${prefix}-${year}-${sequence.toString().padStart(5, "0")}`;
}

export function scaleInvoiceLines(
  lines: InvoiceLineSnapshot[],
  targetAmountInclTax: string,
): InvoiceLineSnapshot[] {
  const sourceTotalCents = sumLineCents(lines, "totalInclTax");
  const targetTotalCents = toCents(targetAmountInclTax);

  if (sourceTotalCents <= 0) {
    throw new Error("Cannot proportionally scale an invoice with a non-positive total");
  }
  if (targetTotalCents <= 0) {
    throw new Error("Invoice amount must be positive");
  }

  const ratio = targetTotalCents / sourceTotalCents;
  const scaled = lines.map((line) => {
    const totalExclTaxCents = Math.round(toCents(line.totalExclTax) * ratio);
    const taxAmountCents = Math.round(toCents(line.taxAmount) * ratio);
    const quantity = Number(line.quantity);
    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;

    return {
      ...line,
      unitPriceExclTax: fromCents(Math.round(totalExclTaxCents / safeQuantity)),
      totalExclTax: fromCents(totalExclTaxCents),
      taxAmount: fromCents(taxAmountCents),
      totalInclTax: fromCents(totalExclTaxCents + taxAmountCents),
    };
  });

  const roundingDifference = targetTotalCents - sumLineCents(scaled, "totalInclTax");
  if (roundingDifference !== 0 && scaled.length > 0) {
    const index = getPositiveAdjustmentIndex(scaled);
    const line = scaled[index];
    const adjustedExclTaxCents = toCents(line.totalExclTax) + roundingDifference;
    const quantity = Number(line.quantity);
    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
    scaled[index] = {
      ...line,
      unitPriceExclTax: fromCents(Math.round(adjustedExclTaxCents / safeQuantity)),
      totalExclTax: fromCents(adjustedExclTaxCents),
      totalInclTax: fromCents(adjustedExclTaxCents + toCents(line.taxAmount)),
    };
  }

  return scaled;
}

function calculateGrossAmounts(
  totalPrice: string,
  taxRate: string | null,
  taxEnabled: boolean,
  displayMode: TaxDisplayMode,
): { exclTaxCents: number; taxCents: number; inclTaxCents: number } {
  const amountCents = toCents(totalPrice);
  const rate = Number(taxRate ?? 0);
  if (!taxEnabled || !taxRate || rate <= 0) {
    return { exclTaxCents: amountCents, taxCents: 0, inclTaxCents: amountCents };
  }

  if (displayMode === "inclusive") {
    const exclTaxCents = toCents(roundMoney(amountCents / 100 / (1 + rate / 100)));
    return {
      exclTaxCents,
      taxCents: amountCents - exclTaxCents,
      inclTaxCents: amountCents,
    };
  }

  const taxCents = toCents(roundMoney((amountCents / 100) * (rate / 100)));
  return {
    exclTaxCents: amountCents,
    taxCents,
    inclTaxCents: amountCents + taxCents,
  };
}

function createLine(input: {
  id: string;
  description: string;
  quantity: number;
  exclTaxCents: number;
  taxCents: number;
  taxRate: string | null;
}): InvoiceLineSnapshot {
  const safeQuantity = input.quantity > 0 ? input.quantity : 1;
  return {
    id: input.id,
    description: input.description,
    quantity: String(safeQuantity),
    unitPriceExclTax: fromCents(Math.round(input.exclTaxCents / safeQuantity)),
    totalExclTax: fromCents(input.exclTaxCents),
    taxRate: fromCents(toCents(input.taxRate)),
    taxAmount: fromCents(input.taxCents),
    totalInclTax: fromCents(input.exclTaxCents + input.taxCents),
  };
}

const CHARGE_LINE_LABELS: Record<
  NonNullable<BuildInvoiceSnapshotsAmounts["chargeKind"]>,
  { fr: string; en: string }
> = {
  damage: { fr: "Dommages et réparations", en: "Damages and repairs" },
  deposit_capture: { fr: "Retenue sur caution — dommages", en: "Deposit retained — damages" },
  adjustment: { fr: "Frais complémentaires", en: "Additional charges" },
};

function buildChargeLine(
  source: BuildInvoiceSnapshotsSource,
  chargeKind: NonNullable<BuildInvoiceSnapshotsAmounts["chargeKind"]>,
  amountInclTax: string,
): InvoiceLineSnapshot {
  const taxSettings = source.store.settings?.tax;
  const taxEnabled = taxSettings?.enabled ?? false;
  const defaultRate = taxEnabled ? String(taxSettings?.defaultRate ?? 0) : null;
  const useFrenchLabels = ["FR", "BE"].includes(source.legalProfile.country);
  // The charged amount is money actually collected, so it is a TTC amount
  // whatever the store's display mode.
  const gross = calculateGrossAmounts(amountInclTax, defaultRate, taxEnabled, "inclusive");

  return createLine({
    id: `charge:${chargeKind}`,
    description: CHARGE_LINE_LABELS[chargeKind][useFrenchLabels ? "fr" : "en"],
    quantity: 1,
    exclTaxCents: gross.exclTaxCents,
    taxCents: gross.taxCents,
    taxRate: defaultRate,
  });
}

function buildFullInvoiceLines(source: BuildInvoiceSnapshotsSource): InvoiceLineSnapshot[] {
  const taxSettings = source.store.settings?.tax;
  const taxEnabled = taxSettings?.enabled ?? false;
  const displayMode = taxSettings?.displayMode ?? "inclusive";
  const defaultRate = taxEnabled ? String(taxSettings?.defaultRate ?? 0) : null;
  const lines: InvoiceLineSnapshot[] = [];
  const discountByRate = new Map<string, { exclTaxCents: number; taxCents: number }>();
  let persistedItemExclTaxCents = 0;
  let persistedItemTaxCents = 0;
  const useFrenchLabels = ["FR", "BE"].includes(source.legalProfile.country);

  for (const item of source.items) {
    const gross = calculateGrossAmounts(item.totalPrice, item.taxRate, taxEnabled, displayMode);
    const persistedExclTaxCents =
      taxEnabled && item.totalExclTax !== null ? toCents(item.totalExclTax) : gross.exclTaxCents;
    const persistedTaxCents =
      taxEnabled && item.taxAmount !== null ? toCents(item.taxAmount) : gross.taxCents;

    persistedItemExclTaxCents += persistedExclTaxCents;
    persistedItemTaxCents += persistedTaxCents;
    lines.push(
      createLine({
        id: item.id,
        description: item.productSnapshot.name,
        quantity: item.quantity,
        exclTaxCents: gross.exclTaxCents,
        taxCents: gross.taxCents,
        taxRate: item.taxRate,
      }),
    );

    const rateKey = item.taxRate ?? "0.00";
    const discount = discountByRate.get(rateKey) ?? { exclTaxCents: 0, taxCents: 0 };
    discount.exclTaxCents += gross.exclTaxCents - persistedExclTaxCents;
    discount.taxCents += gross.taxCents - persistedTaxCents;
    discountByRate.set(rateKey, discount);
  }

  const deliveryFeeCents = toCents(source.reservation.deliveryFee);
  if (deliveryFeeCents > 0) {
    const gross = calculateGrossAmounts(
      fromCents(deliveryFeeCents),
      defaultRate,
      taxEnabled,
      displayMode,
    );
    lines.push(
      createLine({
        id: "delivery",
        description: useFrenchLabels ? "Livraison" : "Delivery",
        quantity: 1,
        exclTaxCents: gross.exclTaxCents,
        taxCents: gross.taxCents,
        taxRate: defaultRate,
      }),
    );

    if (taxEnabled && source.reservation.subtotalExclTax !== null) {
      const persistedDeliveryExclTaxCents =
        toCents(source.reservation.subtotalExclTax) - persistedItemExclTaxCents;
      const persistedDeliveryTaxCents =
        toCents(source.reservation.taxAmount) - persistedItemTaxCents;
      const rateKey = defaultRate ?? "0.00";
      const discount = discountByRate.get(rateKey) ?? { exclTaxCents: 0, taxCents: 0 };
      discount.exclTaxCents += gross.exclTaxCents - persistedDeliveryExclTaxCents;
      discount.taxCents += gross.taxCents - persistedDeliveryTaxCents;
      discountByRate.set(rateKey, discount);
    }
  }

  if (!taxEnabled) {
    const discountCents = toCents(source.reservation.discountAmount);
    if (discountCents > 0) {
      discountByRate.set("0.00", { exclTaxCents: discountCents, taxCents: 0 });
    }
  }

  for (const [rate, discount] of [...discountByRate.entries()].sort(
    ([left], [right]) => Number(left) - Number(right),
  )) {
    if (discount.exclTaxCents === 0 && discount.taxCents === 0) continue;
    lines.push(
      createLine({
        id: `discount:${rate}`,
        description: useFrenchLabels ? "Remise" : "Discount",
        quantity: 1,
        exclTaxCents: -discount.exclTaxCents,
        taxCents: -discount.taxCents,
        taxRate: rate,
      }),
    );
  }

  return lines;
}

function buildVatBreakdown(
  lines: InvoiceLineSnapshot[],
  taxEnabled: boolean,
  insuranceLineIds: ReadonlySet<string>,
): InvoiceVatBreakdownSnapshot[] {
  const byRateAndReason = new Map<
    string,
    { taxRate: string; taxableCents: number; taxCents: number; exemptionReason: string | null }
  >();
  for (const line of lines) {
    const exemptionReason = !taxEnabled
      ? VAT_EXEMPTION_293_B
      : insuranceLineIds.has(line.id)
        ? INSURANCE_VAT_EXEMPTION
        : Number(line.taxRate) === 0
          ? "Exonération de TVA"
          : null;
    const key = `${line.taxRate}:${exemptionReason ?? ""}`;
    const entry = byRateAndReason.get(key) ?? {
      taxRate: line.taxRate,
      taxableCents: 0,
      taxCents: 0,
      exemptionReason,
    };
    entry.taxableCents += toCents(line.totalExclTax);
    entry.taxCents += toCents(line.taxAmount);
    byRateAndReason.set(key, entry);
  }

  return [...byRateAndReason.values()]
    .sort((left, right) => Number(left.taxRate) - Number(right.taxRate))
    .map((entry) => ({
      taxRate: entry.taxRate,
      taxableAmount: fromCents(entry.taxableCents),
      taxAmount: fromCents(entry.taxCents),
      exemptionReason: entry.exemptionReason,
    }));
}

function getInsuranceLineIds(source: BuildInvoiceSnapshotsSource): Set<string> {
  const insuranceAmount = source.reservation.tulipInsuranceAmount;
  if (!insuranceAmount || toCents(insuranceAmount) <= 0) return new Set();

  const insurance = source.items.find(
    (item) => item.productId === null && toCents(item.totalPrice) === toCents(insuranceAmount),
  );
  return new Set(insurance ? [insurance.id] : []);
}

function toSellerSnapshot(source: BuildInvoiceSnapshotsSource): InvoiceSellerSnapshot {
  const profile = source.legalProfile;
  return {
    legalName: profile.legalName,
    legalForm: profile.legalForm,
    companyNumber: profile.companyNumber,
    companyNumberScheme: profile.companyNumberScheme,
    siret: profile.siret,
    vatNumber: profile.vatNumber,
    rcsCity: profile.rcsCity,
    shareCapital: profile.shareCapital,
    address: {
      address: profile.registeredAddress,
      addressComplement: profile.registeredAddressComplement,
      postalCode: profile.registeredPostalCode,
      city: profile.registeredCity,
      country: profile.country,
    },
    email: source.store.email,
    phone: source.store.phone,
  };
}

function toBuyerSnapshot(source: BuildInvoiceSnapshotsSource): InvoiceBuyerSnapshot {
  const customer = source.customer;
  const hasAddress = Boolean(customer.address && customer.postalCode && customer.city);
  return {
    customerType: customer.customerType,
    firstName: customer.firstName,
    lastName: customer.lastName,
    companyName: customer.companyName,
    companyNumber: customer.companyNumber,
    companyNumberScheme: customer.companyNumberScheme,
    vatNumber: customer.vatNumber,
    address: hasAddress
      ? {
          address: customer.address ?? "",
          addressComplement: null,
          postalCode: customer.postalCode ?? "",
          city: customer.city ?? "",
          country: customer.country ?? source.legalProfile.country,
        }
      : null,
    email: customer.email,
    phone: customer.phone,
  };
}

function toEn16931Address(
  address: InvoiceSellerSnapshot["address"] | null,
  fallbackCountry: string,
): En16931PostalAddress {
  if (!address) return { country_code: fallbackCountry };
  return {
    address_line1: address.address,
    ...(address.addressComplement ? { address_line2: address.addressComplement } : {}),
    post_code: address.postalCode,
    city: address.city,
    country_code: address.country,
  };
}

function toEn16931Seller(seller: InvoiceSellerSnapshot): En16931Party {
  const electronicAddress: En16931ElectronicAddress =
    seller.companyNumberScheme === "be_bce"
      ? { scheme: "0208", value: seller.companyNumber }
      : seller.companyNumberScheme === "fr_siren"
        ? { scheme: "0225", value: seller.companyNumber }
        : { scheme: "EM", value: seller.email ?? seller.companyNumber };
  return {
    name: seller.legalName,
    electronic_address: electronicAddress,
    postal_address: toEn16931Address(seller.address, seller.address.country),
    ...(seller.companyNumberScheme
      ? {
          legal_registration_identifier: {
            // ISO 6523: 0002 = SIRENE (SIREN), 0208 = BCE. 0225 only
            // addresses the electronic invoicing mailbox, not the registry.
            scheme: seller.companyNumberScheme === "be_bce" ? "0208" : "0002",
            value: seller.companyNumber,
          },
        }
      : {}),
    ...(seller.vatNumber ? { vat_identifier: seller.vatNumber } : {}),
  };
}

function toEn16931Buyer(
  buyer: InvoiceBuyerSnapshot,
  processingRule: "b2b" | "b2c",
  fallbackCountry: string,
): En16931Party {
  const isB2b = processingRule === "b2b";
  return {
    name:
      isB2b && buyer.companyName
        ? buyer.companyName
        : `${buyer.firstName} ${buyer.lastName}`.trim(),
    electronic_address: isB2b
      ? {
          scheme: buyer.companyNumberScheme === "be_bce" ? "0208" : "0225",
          value: buyer.companyNumber ?? "",
        }
      : { scheme: "EM", value: buyer.email },
    postal_address: toEn16931Address(buyer.address, fallbackCountry),
    ...(isB2b && buyer.companyNumber
      ? {
          legal_registration_identifier: {
            scheme: buyer.companyNumberScheme === "be_bce" ? "0208" : "0002",
            value: buyer.companyNumber,
          },
        }
      : {}),
    ...(buyer.vatNumber ? { vat_identifier: buyer.vatNumber } : {}),
  };
}

function toEn16931Totals(
  totals: BuiltInvoiceSnapshots["totals"],
  currency: string,
): En16931Invoice["totals"] {
  return {
    sum_invoice_lines_amount: totals.totalExclTax,
    total_without_vat: totals.totalExclTax,
    total_vat_amount: { currency_code: currency, value: totals.totalTax },
    total_with_vat: totals.totalInclTax,
    amount_due_for_payment: totals.totalInclTax,
  };
}

function toEn16931VatBreakdown(vatBreakdown: InvoiceVatBreakdownSnapshot[]): En16931VatBreakdown[] {
  return vatBreakdown.map((entry) => ({
    vat_category_code: entry.exemptionReason ? "E" : "S",
    vat_category_rate: entry.taxRate,
    vat_category_taxable_amount: entry.taxableAmount,
    vat_category_tax_amount: entry.taxAmount,
    ...(entry.exemptionReason ? { vat_exemption_reason: entry.exemptionReason } : {}),
  }));
}

function toEn16931Lines(
  lines: InvoiceLineSnapshot[],
  getExemptionReason: (line: InvoiceLineSnapshot) => string | undefined,
): En16931Line[] {
  return lines.map((line) => {
    const exemptionReason = getExemptionReason(line);
    return {
      identifier: line.id,
      invoiced_quantity: line.quantity,
      invoiced_quantity_code: "C62",
      net_amount: line.totalExclTax,
      price_details: {
        item_net_price: line.unitPriceExclTax,
        item_price_base_quantity: "1",
        quantity_unit_code: "C62",
      },
      item_information: { name: line.description },
      vat_information: {
        invoiced_item_vat_category_code: exemptionReason ? "E" : "S",
        invoiced_item_vat_rate: line.taxRate,
        ...(exemptionReason ? { exemption_reason: exemptionReason } : {}),
      },
    };
  });
}

export function buildInvoiceSnapshots(
  source: BuildInvoiceSnapshotsSource,
  amounts: BuildInvoiceSnapshotsAmounts,
): BuiltInvoiceSnapshots {
  const seller = toSellerSnapshot(source);
  const buyer = toBuyerSnapshot(source);
  const taxEnabled = source.store.settings?.tax?.enabled ?? false;
  const lines = amounts.chargeKind
    ? [buildChargeLine(source, amounts.chargeKind, amounts.amountInclTax)]
    : scaleInvoiceLines(buildFullInvoiceLines(source), amounts.amountInclTax);
  const insuranceLineIds = amounts.chargeKind ? new Set<string>() : getInsuranceLineIds(source);
  const vatBreakdown = buildVatBreakdown(lines, taxEnabled, insuranceLineIds);
  const totals = {
    totalExclTax: fromCents(sumLineCents(lines, "totalExclTax")),
    totalTax: fromCents(sumLineCents(lines, "taxAmount")),
    totalInclTax: fromCents(sumLineCents(lines, "totalInclTax")),
  };
  const isB2b =
    buyer.customerType === "business" &&
    (buyer.companyNumberScheme === "fr_siren" || buyer.companyNumberScheme === "be_bce") &&
    Boolean(buyer.companyNumber);
  const processingRule = isB2b ? "b2b" : "b2c";
  const notes: En16931Invoice["notes"] = [];
  if (!isB2b) notes.push({ subject_code: "BAR", note: "B2C" });
  if (!taxEnabled) notes.push({ subject_code: "REG", note: VAT_EXEMPTION_293_B });
  // BR-FR-05/BT-22: the three French payment-terms mentions are mandatory
  // notes (same texts as the PDF footer).
  if (source.legalProfile.country === "FR") {
    notes.push(
      {
        subject_code: "PMD",
        note: "Pénalités de retard : taux égal à trois fois le taux d'intérêt légal, exigibles sans rappel.",
      },
      {
        subject_code: "PMT",
        note: "Indemnité forfaitaire de 40 € pour frais de recouvrement due en cas de retard de paiement (professionnels).",
      },
      { subject_code: "AAB", note: "Escompte pour paiement anticipé : néant." },
    );
  }

  const en16931: En16931Invoice = {
    number: amounts.number,
    issue_date: amounts.issueDate,
    // PEPPOL-EN16931-R008: the converter always emits the CII delivery block;
    // a delivery/service date keeps it from being empty. The cash-in date
    // doubles as the service date for point-of-payment invoicing.
    delivery_information: { delivery_date: amounts.issueDate },
    type_code: amounts.type === "invoice" ? 380 : 381,
    currency_code: amounts.currency,
    process_control: {
      specification_identifier: "urn:cen.eu:en16931:2017",
      // BR-FR-08/BT-23: French "cadre de facturation" code — B1 = standard
      // invoice deposit (not the Peppol billing URN).
      business_process_type: "B1",
    },
    seller: toEn16931Seller(seller),
    buyer: toEn16931Buyer(buyer, processingRule, source.customer.country ?? seller.address.country),
    payment_due_date: amounts.issueDate,
    totals: toEn16931Totals(totals, amounts.currency),
    vat_break_down: toEn16931VatBreakdown(vatBreakdown),
    lines: toEn16931Lines(lines, (line) =>
      !taxEnabled
        ? VAT_EXEMPTION_293_B
        : insuranceLineIds.has(line.id)
          ? INSURANCE_VAT_EXEMPTION
          : (vatBreakdown.find((entry) => entry.taxRate === line.taxRate)?.exemptionReason ??
            undefined),
    ),
    ...(notes.length > 0 ? { notes } : {}),
    ...(amounts.precedingInvoice
      ? {
          preceding_invoice_references: [
            {
              reference: amounts.precedingInvoice.number,
              issue_date: amounts.precedingInvoice.issueDate,
              preceding_invoice_type_code: 380,
            },
          ],
        }
      : {}),
  };

  return { seller, buyer, lines, vatBreakdown, totals, processingRule, en16931 };
}

export function buildCreditNoteSnapshots(
  original: Pick<
    BuiltInvoiceSnapshots,
    "seller" | "buyer" | "lines" | "vatBreakdown" | "processingRule"
  >,
  source: BuildInvoiceSnapshotsSource,
  amounts: BuildInvoiceSnapshotsAmounts & {
    type: "credit_note";
    precedingInvoice: { number: string; issueDate: string };
  },
): BuiltInvoiceSnapshots {
  const draft = buildInvoiceSnapshots(source, amounts);
  const lines = scaleInvoiceLines(original.lines, amounts.amountInclTax);
  const originalExemptions = new Map(
    original.vatBreakdown.map((entry) => [entry.taxRate, entry.exemptionReason]),
  );
  const vatBreakdown = buildVatBreakdown(lines, true, new Set()).map((entry) => ({
    ...entry,
    exemptionReason: originalExemptions.get(entry.taxRate) ?? entry.exemptionReason,
  }));
  const totals = {
    totalExclTax: fromCents(sumLineCents(lines, "totalExclTax")),
    totalTax: fromCents(sumLineCents(lines, "taxAmount")),
    totalInclTax: fromCents(sumLineCents(lines, "totalInclTax")),
  };
  const en16931: En16931Invoice = {
    ...draft.en16931,
    seller: toEn16931Seller(original.seller),
    buyer: toEn16931Buyer(
      original.buyer,
      original.processingRule,
      source.customer.country ?? original.seller.address.country,
    ),
    totals: toEn16931Totals(totals, amounts.currency),
    vat_break_down: toEn16931VatBreakdown(vatBreakdown),
    lines: toEn16931Lines(
      lines,
      (line) =>
        vatBreakdown.find((entry) => entry.taxRate === line.taxRate)?.exemptionReason ?? undefined,
    ),
  };

  return {
    seller: original.seller,
    buyer: original.buyer,
    lines,
    vatBreakdown,
    totals,
    processingRule: original.processingRule,
    en16931,
  };
}
