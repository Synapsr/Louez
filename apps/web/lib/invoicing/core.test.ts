import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCreditNoteSnapshots,
  buildInvoiceSnapshots,
  formatInvoiceNumber,
  scaleInvoiceLines,
  type BuildInvoiceSnapshotsSource,
} from "./core";

const baseSource: BuildInvoiceSnapshotsSource = {
  reservation: {
    deliveryFee: "12.00",
    discountAmount: "17.00",
    subtotalExclTax: "147.39",
    taxAmount: "22.61",
    tulipInsuranceAmount: null,
  },
  items: [
    {
      id: "standard",
      productId: "product-standard",
      quantity: 1,
      unitPrice: "120.00",
      totalPrice: "120.00",
      taxRate: "20.00",
      taxAmount: "18.18",
      priceExclTax: "100.00",
      totalExclTax: "90.91",
      productSnapshot: { name: "Location sono" },
    },
    {
      id: "reduced",
      productId: "product-reduced",
      quantity: 1,
      unitPrice: "55.00",
      totalPrice: "55.00",
      taxRate: "5.50",
      taxAmount: "2.61",
      priceExclTax: "52.13",
      totalExclTax: "47.39",
      productSnapshot: { name: "Location accessoire" },
    },
  ],
  store: {
    email: "billing@seller.test",
    phone: "+33102030405",
    settings: {
      tax: { enabled: true, displayMode: "inclusive", defaultRate: 20 },
    },
  },
  legalProfile: {
    legalName: "Loueur Exemple",
    legalForm: "SAS",
    companyNumber: "123456789",
    companyNumberScheme: "fr_siren",
    siret: "12345678900012",
    vatNumber: "FR00123456789",
    rcsCity: "Paris",
    shareCapital: "10000.00",
    registeredAddress: "1 rue de la Location",
    registeredAddressComplement: null,
    registeredPostalCode: "75001",
    registeredCity: "Paris",
    country: "FR",
  },
  customer: {
    customerType: "individual",
    firstName: "Alice",
    lastName: "Martin",
    companyName: null,
    companyNumber: null,
    companyNumberScheme: null,
    vatNumber: null,
    address: "2 rue Cliente",
    city: "Lyon",
    postalCode: "69001",
    country: "FR",
    email: "alice@example.test",
    phone: null,
  },
};

test("invoice numbers use the legal series and five-digit annual sequence", () => {
  assert.equal(formatInvoiceNumber("invoice", 2026, 42), "F-2026-00042");
  assert.equal(formatInvoiceNumber("credit_note", 2026, 7), "AV-2026-00007");
});

test("proportional scaling reconciles rounded line amounts to the paid total", () => {
  const scaled = scaleInvoiceLines(
    [
      {
        id: "standard",
        description: "Location sono",
        quantity: "1",
        unitPriceExclTax: "100.00",
        totalExclTax: "100.00",
        taxRate: "20.00",
        taxAmount: "20.00",
        totalInclTax: "120.00",
      },
      {
        id: "reduced",
        description: "Location accessoire",
        quantity: "1",
        unitPriceExclTax: "52.13",
        totalExclTax: "52.13",
        taxRate: "5.50",
        taxAmount: "2.87",
        totalInclTax: "55.00",
      },
    ],
    "58.33",
  );

  assert.deepEqual(
    scaled.map(({ totalExclTax, taxAmount, totalInclTax }) => ({
      totalExclTax,
      taxAmount,
      totalInclTax,
    })),
    [
      { totalExclTax: "33.33", taxAmount: "6.67", totalInclTax: "40.00" },
      { totalExclTax: "17.37", taxAmount: "0.96", totalInclTax: "18.33" },
    ],
  );
});

test("B2C inclusive invoices carry email routing, BAR note, and service lines", () => {
  const built = buildInvoiceSnapshots(baseSource, {
    number: "F-2026-00042",
    issueDate: "2026-08-20",
    type: "invoice",
    currency: "EUR",
    amountInclTax: "170.00",
  });

  assert.equal(built.processingRule, "b2c");
  assert.deepEqual(built.en16931.buyer.electronic_address, {
    scheme: "EM",
    value: "alice@example.test",
  });
  assert.deepEqual(built.en16931.seller.electronic_address, {
    scheme: "0225",
    value: "123456789",
  });
  assert.deepEqual(built.en16931.notes, [{ subject_code: "BAR", content: "B2C" }]);
  assert.ok(built.en16931.lines.every((line) => line.item.type === "SERVICES"));
  assert.deepEqual(built.totals, {
    totalExclTax: "147.39",
    totalTax: "22.61",
    totalInclTax: "170.00",
  });
});

test("B2B exclusive invoices use the customer's SIREN electronic address", () => {
  const built = buildInvoiceSnapshots(
    {
      ...baseSource,
      reservation: {
        deliveryFee: "10.00",
        discountAmount: "0.00",
        subtotalExclTax: "110.00",
        taxAmount: "22.00",
        tulipInsuranceAmount: null,
      },
      items: [
        {
          ...baseSource.items[0],
          unitPrice: "100.00",
          totalPrice: "100.00",
          totalExclTax: "100.00",
          taxAmount: "20.00",
        },
      ],
      store: {
        ...baseSource.store,
        settings: {
          tax: { enabled: true, displayMode: "exclusive", defaultRate: 20 },
        },
      },
      legalProfile: {
        ...baseSource.legalProfile,
        companyNumber: "0123456789",
        companyNumberScheme: "be_bce",
        country: "BE",
      },
      customer: {
        ...baseSource.customer,
        customerType: "business",
        companyName: "Acheteur Pro",
        companyNumber: "987654321",
        companyNumberScheme: "fr_siren",
      },
    },
    {
      number: "F-2026-00043",
      issueDate: "2026-08-20",
      type: "invoice",
      currency: "EUR",
      amountInclTax: "132.00",
    },
  );

  assert.equal(built.processingRule, "b2b");
  assert.deepEqual(built.en16931.buyer.electronic_address, {
    scheme: "0225",
    value: "987654321",
  });
  assert.deepEqual(built.en16931.seller.electronic_address, {
    scheme: "0208",
    value: "0123456789",
  });
  assert.equal(built.en16931.notes, undefined);
  assert.deepEqual(built.totals, {
    totalExclTax: "110.00",
    totalTax: "22.00",
    totalInclTax: "132.00",
  });
});

test("credit notes scale the immutable original invoice and reference it", () => {
  const original = buildInvoiceSnapshots(baseSource, {
    number: "F-2026-00042",
    issueDate: "2026-08-20",
    type: "invoice",
    currency: "EUR",
    amountInclTax: "170.00",
  });
  const built = buildCreditNoteSnapshots(original, baseSource, {
    number: "AV-2026-00007",
    issueDate: "2026-08-21",
    type: "credit_note",
    currency: "EUR",
    amountInclTax: "85.00",
    precedingInvoice: { number: "F-2026-00042", issueDate: "2026-08-20" },
  });

  assert.equal(built.en16931.type_code, "381");
  assert.deepEqual(built.en16931.preceding_invoice_references, [
    { number: "F-2026-00042", issue_date: "2026-08-20" },
  ]);
  assert.equal(built.totals.totalInclTax, "85.00");
  assert.deepEqual(
    built.vatBreakdown.map(({ taxRate, taxableAmount, taxAmount }) => ({
      taxRate,
      taxableAmount,
      taxAmount,
    })),
    [
      { taxRate: "5.50", taxableAmount: "23.70", taxAmount: "1.31" },
      { taxRate: "20.00", taxableAmount: "49.99", taxAmount: "10.00" },
    ],
  );
});

test("tax-disabled invoices carry the French 293 B exemption on breakdown and note", () => {
  const built = buildInvoiceSnapshots(
    {
      ...baseSource,
      reservation: {
        deliveryFee: "0.00",
        discountAmount: "0.00",
        subtotalExclTax: null,
        taxAmount: null,
        tulipInsuranceAmount: null,
      },
      items: [
        {
          ...baseSource.items[0],
          unitPrice: "100.00",
          totalPrice: "100.00",
          taxRate: null,
          taxAmount: null,
          priceExclTax: null,
          totalExclTax: null,
        },
      ],
      store: {
        ...baseSource.store,
        settings: {
          tax: { enabled: false, displayMode: "inclusive", defaultRate: 20 },
        },
      },
    },
    {
      number: "F-2026-00044",
      issueDate: "2026-08-20",
      type: "invoice",
      currency: "EUR",
      amountInclTax: "100.00",
    },
  );

  const reason = "TVA non applicable, art. 293 B du CGI";
  assert.deepEqual(built.vatBreakdown, [
    { taxRate: "0.00", taxableAmount: "100.00", taxAmount: "0.00", exemptionReason: reason },
  ]);
  assert.ok(built.en16931.notes?.some((note) => note.content === reason));
});

test("insurance lines use the distinct article 261 C VAT exemption", () => {
  const insuranceReason = "Exonération de TVA — art. 261 C, 2° du CGI";
  const built = buildInvoiceSnapshots(
    {
      ...baseSource,
      reservation: {
        deliveryFee: "0.00",
        discountAmount: "0.00",
        subtotalExclTax: "115.00",
        taxAmount: "20.00",
        tulipInsuranceAmount: "15.00",
      },
      items: [
        {
          ...baseSource.items[0],
          unitPrice: "100.00",
          totalPrice: "100.00",
          totalExclTax: "83.33",
          taxAmount: "16.67",
        },
        {
          id: "insurance",
          productId: null,
          quantity: 1,
          unitPrice: "15.00",
          totalPrice: "15.00",
          taxRate: null,
          taxAmount: "0.00",
          priceExclTax: "15.00",
          totalExclTax: "15.00",
          productSnapshot: { name: "Garantie casse/vol" },
        },
      ],
    },
    {
      number: "F-2026-00045",
      issueDate: "2026-08-20",
      type: "invoice",
      currency: "EUR",
      amountInclTax: "115.00",
    },
  );

  assert.ok(built.vatBreakdown.some((entry) => entry.exemptionReason === insuranceReason));
  assert.equal(
    built.en16931.lines.find((line) => line.id === "insurance")?.vat.exemption_reason,
    insuranceReason,
  );
});

test("post-return charges are invoiced as one dedicated line, never scaled rental lines", () => {
  const built = buildInvoiceSnapshots(baseSource, {
    number: "F-2026-00007",
    issueDate: "2026-08-21",
    type: "invoice",
    currency: "EUR",
    amountInclTax: "90.00",
    chargeKind: "deposit_capture",
  });

  assert.equal(built.lines.length, 1);
  const [line] = built.lines;
  assert.equal(line.id, "charge:deposit_capture");
  assert.equal(line.description, "Retenue sur caution — dommages");
  // Collected money is TTC: 90.00 at 20% → 75.00 HT + 15.00 VAT.
  assert.equal(line.totalInclTax, "90.00");
  assert.equal(line.totalExclTax, "75.00");
  assert.equal(line.taxAmount, "15.00");
  assert.equal(built.totals.totalInclTax, "90.00");
  assert.equal(built.vatBreakdown.length, 1);
  assert.equal(built.vatBreakdown[0]?.taxableAmount, "75.00");
  assert.equal(
    built.en16931.lines.some((line2) => line2.item.name.includes("Location")),
    false,
  );
});
