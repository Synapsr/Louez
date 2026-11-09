import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isValidElement, type ReactNode } from "react";
import * as nodeModule from "node:module";
import fr from "@/messages/fr.json";
import type { ContractSignatureMethod } from "@louez/db";
import type { ContractCustomerFieldLine } from "./util.contract-customer-fields";

const fixtureDirectory = mkdtempSync(join(tmpdir(), "louez-contract-test-"));
const fixturePath = join(fixtureDirectory, "env.cjs");
writeFileSync(fixturePath, "exports.env = { NEXT_PUBLIC_APP_URL: 'https://example.invalid' };");
after(() => rmSync(fixtureDirectory, { recursive: true }));
const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function")
  throw new Error("This test requires Node.js registerHooks");
registerHooks({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    nextResolve: (
      specifier: string,
      context: { parentURL?: string },
    ) => { url: string; shortCircuit?: boolean },
  ) {
    if (specifier === "@/env" || specifier.endsWith("/apps/web/env.ts"))
      return { shortCircuit: true, url: pathToFileURL(fixturePath).href };
    return specifier === "server-only"
      ? { shortCircuit: true, url: "node:module" }
      : nextResolve(specifier, context);
  },
});

const textOf = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
};

const renderText = async ({
  signedAt = null,
  contractValidatedAt = null,
  signatureMethod = null,
  signatureIp = null,
  drawnSignature = null,
  customFieldLines,
}: {
  signedAt?: Date | null;
  contractValidatedAt?: Date | null;
  signatureMethod?: ContractSignatureMethod | null;
  signatureIp?: string | null;
  drawnSignature?: { signerName: string; image: string } | null;
  customFieldLines?: ContractCustomerFieldLine[];
}) => {
  const { ContractDocument } = await import("./contract");
  return textOf(
    ContractDocument({
      store: {
        slug: "test",
        name: "Test location",
        address: null,
        phone: null,
        email: null,
        logoUrl: null,
        siret: null,
        tvaNumber: null,
      },
      reservation: {
        number: "TEST",
        startDate: new Date("2026-09-10T09:00:00Z"),
        endDate: new Date("2026-09-11T09:00:00Z"),
        createdAt: new Date("2026-09-08T09:00:00Z"),
        signedAt,
        contractValidatedAt,
        signatureMethod,
        signatureIp,
        drawnSignature,
        subtotalAmount: "20",
        totalAmount: "20",
        depositAmount: "0",
        customer: {
          firstName: "Test",
          lastName: "Client",
          email: "test@example.invalid",
          phone: null,
          address: null,
          customFieldLines,
        },
        items: [],
        payments: [],
      },
      document: { number: "TEST", generatedAt: new Date("2026-09-08T09:00:00Z") },
      translations: fr.contract,
      locale: "fr",
      timezone: "Europe/Paris",
    }),
  );
};

const bookedAt = new Date("2026-09-08T09:00:00Z");
const validatedAt = new Date("2026-09-09T09:00:00Z");

test("a validated contract the customer has not accepted waits for their signature", async () => {
  const text = await renderText({ contractValidatedAt: validatedAt });
  assert.ok(text.includes(fr.contract.signature.pending));
  assert.ok(text.includes(fr.contract.signature.customerText));
  assert.ok(!text.includes(fr.contract.signature.ipLabel));
  assert.ok(!text.includes(fr.contract.signature.atBookingText));
});

test("a storefront booking reads as signed at booking, with its booking and validation dates", async () => {
  const text = await renderText({
    signedAt: bookedAt,
    contractValidatedAt: validatedAt,
    signatureMethod: "checkout",
    signatureIp: "203.0.113.7",
  });
  assert.ok(text.includes(fr.contract.signature.atBooking));
  assert.ok(text.includes(fr.contract.signature.atBookingText));
  assert.ok(text.includes(fr.contract.signature.signedOnLabel));
  assert.ok(text.includes(fr.contract.signature.validatedOnLabel));
  assert.ok(text.includes("203.0.113.7"));
  assert.ok(!text.includes(fr.contract.signature.customerText));
});

test("a customer who accepted the contract after its validation reads as signed, with date and IP", async () => {
  const text = await renderText({
    signedAt: new Date("2026-09-09T18:00:00Z"),
    contractValidatedAt: validatedAt,
    signatureMethod: "account",
    signatureIp: "203.0.113.7",
  });
  assert.ok(text.includes(fr.contract.signature.signed));
  assert.ok(text.includes(fr.contract.signature.customerText));
  assert.ok(text.includes(fr.contract.signature.ipLabel) && text.includes("203.0.113.7"));
  assert.ok(!text.includes(fr.contract.signature.pending));
});

test("a contract signed in store prints the signer and the drawn signature, not the store's IP", async () => {
  const text = await renderText({
    signedAt: new Date("2026-09-10T08:55:00Z"),
    contractValidatedAt: validatedAt,
    signatureMethod: "in_store",
    signatureIp: "198.51.100.4",
    drawnSignature: { signerName: "Test Client", image: "data:image/png;base64,iVBORw0KGgo=" },
  });
  assert.ok(text.includes(fr.contract.signature.inStore));
  assert.ok(text.includes(fr.contract.signature.signerLabel));
  assert.ok(text.includes("Test Client"));
  assert.ok(!text.includes("198.51.100.4"));
  assert.ok(!text.includes(fr.contract.signature.pending));
});

test("custom fields flagged for the contract are printed under the customer", async () => {
  const text = await renderText({
    customFieldLines: [
      { id: "cpf", label: "CPF / CNPJ", value: "529.982.247-25" },
      { id: "boat", label: "Permis bateau", value: null },
    ],
  });
  assert.ok(text.includes("CPF / CNPJ : 529.982.247-25"));
  assert.ok(text.includes("Permis bateau"));
  assert.ok(!text.includes("Permis bateau :"));
});
