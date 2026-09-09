import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isValidElement, type ReactNode } from "react";
import * as nodeModule from "node:module";
import fr from "@/messages/fr.json";

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

const renderText = async (automatic: boolean) => {
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
        signedAt: new Date("2026-09-08T09:00:00Z"),
        automaticContractValidation: automatic,
        subtotalAmount: "20",
        totalAmount: "20",
        depositAmount: "0",
        customer: {
          firstName: "Test",
          lastName: "Client",
          email: "test@example.invalid",
          phone: null,
          address: null,
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

test("automatic validation uses factual wording instead of a customer signature declaration", async () => {
  const text = await renderText(true);
  assert.ok(text.includes(fr.contract.signature.automatic));
  assert.ok(text.includes(fr.contract.signature.automaticText));
  assert.ok(!text.includes(fr.contract.signature.customerText));
});

test("existing customer signatures retain their original wording", async () => {
  const text = await renderText(false);
  assert.ok(text.includes(fr.contract.signature.customerText));
  assert.ok(!text.includes(fr.contract.signature.automaticText));
});
