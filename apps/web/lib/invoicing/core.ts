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
  precedingInvoice?: { number: string; issueDate: string };
}

interface En16931ElectronicAddress {
  scheme: "0225" | "0208" | "EM";
  value: string;
}

interface En16931Party {
  name: string;
  electronic_address: En16931ElectronicAddress;
  postal_address: {
    line_one: string;
    line_two: string | null;
    post_code: string;
    city: string;
    country_code: string;
  } | null;
  legal_registration_identifier?: { scheme: string; value: string };
  vat_identifier?: string;
}

interface En16931Line {
  id: string;
  item: { name: string; type: "SERVICES" };
  quantity: string;
  unit_code: "C62";
  net_price: string;
  net_amount: string;
  vat: {
    category_code: "S" | "E";
    rate: string;
    exemption_reason?: string;
  };
}

interface En16931VatBreakdown {
  category_code: "S" | "E";
  rate: string;
  taxable_amount: string;
  tax_amount: string;
  exemption_reason?: string;
}

export interface En16931Invoice {
  [key: string]: unknown;
  number: string;
  issue_date: string;
  type_code: "380" | "381";
  currency_code: string;
  process_control: {
    specification_identifier: string;
    business_process_type: string;
  };
  seller: En16931Party;
  buyer: En16931Party;
  invoice_totals: {
    sum_invoice_line_net_amount: string;
    invoice_total_amount_without_vat: string;
    invoice_total_vat_amount: string;
    invoice_total_amount_with_vat: string;
    payable_amount: string;
  };
  vat_break_down: En16931VatBreakdown[];
  lines: En16931Line[];
  notes?: { subject_code: "BAR" | "REG"; content: string }[];
  preceding_invoice_references?: { number: string; issue_date: string }[];
}

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

function toEn16931Address(address: InvoiceSellerSnapshot["address"] | null) {
  if (!address) return null;
  return {
    line_one: address.address,
    line_two: address.addressComplement,
    post_code: address.postalCode,
    city: address.city,
    country_code: address.country,
  };
}

function toEn16931Seller(seller: InvoiceSellerSnapshot): En16931Party {
  const electronicAddress: En16931ElectronicAddress =
    seller.address.country === "BE"
      ? { scheme: "0208", value: seller.companyNumber }
      : seller.address.country === "FR"
        ? { scheme: "0225", value: seller.companyNumber }
        : { scheme: "EM", value: seller.email ?? seller.companyNumber };
  const registrationScheme =
    seller.address.country === "BE" ? "0208" : seller.address.country === "FR" ? "0225" : "LOCAL";
  return {
    name: seller.legalName,
    electronic_address: electronicAddress,
    postal_address: toEn16931Address(seller.address),
    legal_registration_identifier: {
      scheme: registrationScheme,
      value: seller.companyNumber,
    },
    ...(seller.vatNumber ? { vat_identifier: seller.vatNumber } : {}),
  };
}

function toEn16931Buyer(buyer: InvoiceBuyerSnapshot, processingRule: "b2b" | "b2c"): En16931Party {
  const isB2b = processingRule === "b2b";
  return {
    name:
      isB2b && buyer.companyName
        ? buyer.companyName
        : `${buyer.firstName} ${buyer.lastName}`.trim(),
    electronic_address: isB2b
      ? { scheme: "0225", value: buyer.companyNumber ?? "" }
      : { scheme: "EM", value: buyer.email },
    postal_address: toEn16931Address(buyer.address),
    ...(isB2b && buyer.companyNumber
      ? {
          legal_registration_identifier: {
            scheme: "0225",
            value: buyer.companyNumber,
          },
        }
      : {}),
    ...(buyer.vatNumber ? { vat_identifier: buyer.vatNumber } : {}),
  };
}

export function buildInvoiceSnapshots(
  source: BuildInvoiceSnapshotsSource,
  amounts: BuildInvoiceSnapshotsAmounts,
): BuiltInvoiceSnapshots {
  const seller = toSellerSnapshot(source);
  const buyer = toBuyerSnapshot(source);
  const taxEnabled = source.store.settings?.tax?.enabled ?? false;
  const lines = scaleInvoiceLines(buildFullInvoiceLines(source), amounts.amountInclTax);
  const insuranceLineIds = getInsuranceLineIds(source);
  const vatBreakdown = buildVatBreakdown(lines, taxEnabled, insuranceLineIds);
  const totals = {
    totalExclTax: fromCents(sumLineCents(lines, "totalExclTax")),
    totalTax: fromCents(sumLineCents(lines, "taxAmount")),
    totalInclTax: fromCents(sumLineCents(lines, "totalInclTax")),
  };
  const isB2b =
    buyer.customerType === "business" &&
    buyer.companyNumberScheme === "fr_siren" &&
    Boolean(buyer.companyNumber);
  const processingRule = isB2b ? "b2b" : "b2c";
  const notes: En16931Invoice["notes"] = [];
  if (!isB2b) notes.push({ subject_code: "BAR", content: "B2C" });
  if (!taxEnabled) notes.push({ subject_code: "REG", content: VAT_EXEMPTION_293_B });

  const en16931: En16931Invoice = {
    number: amounts.number,
    issue_date: amounts.issueDate,
    type_code: amounts.type === "invoice" ? "380" : "381",
    currency_code: amounts.currency,
    process_control: {
      specification_identifier: "urn:cen.eu:en16931:2017",
      business_process_type: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
    },
    seller: toEn16931Seller(seller),
    buyer: toEn16931Buyer(buyer, processingRule),
    invoice_totals: {
      sum_invoice_line_net_amount: totals.totalExclTax,
      invoice_total_amount_without_vat: totals.totalExclTax,
      invoice_total_vat_amount: totals.totalTax,
      invoice_total_amount_with_vat: totals.totalInclTax,
      payable_amount: totals.totalInclTax,
    },
    vat_break_down: vatBreakdown.map((entry) => ({
      category_code: entry.exemptionReason ? "E" : "S",
      rate: entry.taxRate,
      taxable_amount: entry.taxableAmount,
      tax_amount: entry.taxAmount,
      ...(entry.exemptionReason ? { exemption_reason: entry.exemptionReason } : {}),
    })),
    lines: lines.map((line) => {
      const exemptionReason = !taxEnabled
        ? VAT_EXEMPTION_293_B
        : insuranceLineIds.has(line.id)
          ? INSURANCE_VAT_EXEMPTION
          : vatBreakdown.find((entry) => entry.taxRate === line.taxRate)?.exemptionReason;
      return {
        id: line.id,
        item: { name: line.description, type: "SERVICES" },
        quantity: line.quantity,
        unit_code: "C62",
        net_price: line.unitPriceExclTax,
        net_amount: line.totalExclTax,
        vat: {
          category_code: exemptionReason ? "E" : "S",
          rate: line.taxRate,
          ...(exemptionReason ? { exemption_reason: exemptionReason } : {}),
        },
      };
    }),
    ...(notes.length > 0 ? { notes } : {}),
    ...(amounts.precedingInvoice
      ? {
          preceding_invoice_references: [
            {
              number: amounts.precedingInvoice.number,
              issue_date: amounts.precedingInvoice.issueDate,
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
    buyer: toEn16931Buyer(original.buyer, original.processingRule),
    invoice_totals: {
      sum_invoice_line_net_amount: totals.totalExclTax,
      invoice_total_amount_without_vat: totals.totalExclTax,
      invoice_total_vat_amount: totals.totalTax,
      invoice_total_amount_with_vat: totals.totalInclTax,
      payable_amount: totals.totalInclTax,
    },
    vat_break_down: vatBreakdown.map((entry) => ({
      category_code: entry.exemptionReason ? "E" : "S",
      rate: entry.taxRate,
      taxable_amount: entry.taxableAmount,
      tax_amount: entry.taxAmount,
      ...(entry.exemptionReason ? { exemption_reason: entry.exemptionReason } : {}),
    })),
    lines: lines.map((line) => {
      const exemptionReason = vatBreakdown.find(
        (entry) => entry.taxRate === line.taxRate,
      )?.exemptionReason;
      return {
        id: line.id,
        item: { name: line.description, type: "SERVICES" },
        quantity: line.quantity,
        unit_code: "C62",
        net_price: line.unitPriceExclTax,
        net_amount: line.totalExclTax,
        vat: {
          category_code: exemptionReason ? "E" : "S",
          rate: line.taxRate,
          ...(exemptionReason ? { exemption_reason: exemptionReason } : {}),
        },
      };
    }),
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
