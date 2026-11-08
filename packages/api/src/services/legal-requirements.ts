import type { LegalRequirementsView, LegalFieldKey } from "../contracts/launch";

/**
 * What French law asks of a store that sells to consumers before it opens:
 * terms of sale customers can read before they book (Code de la
 * consommation), and a legal notice naming who runs the site (LCEN, art. 6).
 * Louez has no setting for a store that sells to businesses only, so a store
 * in France is read as selling to consumers.
 *
 * The storefront's legal notice page shows the store's own text when it has
 * one; without it, only the store's name, address, email and phone, and on
 * Louez Cloud the host. The legal profile is not shown there: its identity
 * belongs in the text. The launch warns, it never blocks.
 */

export interface LegalFacts {
  country: string | null | undefined;
  termsWritten: boolean;
  legalNoticeWritten: boolean;
  email: string | null;
  phone: string | null;
  profile: {
    legalName: string | null;
    legalForm: string | null;
    companyNumber: string | null;
    registeredAddress: string | null;
  } | null;
  hostedBy: "lumycloud" | null;
}

const PROFILE_TOOLS = ["settings_search_company_registry", "settings_update_legal_profile"];
const has = (value: string | null | undefined) => Boolean(value?.trim());

/** The requirements of a store in France, or null for another country. */
export function frenchLegalRequirements(facts: LegalFacts): LegalRequirementsView | null {
  if (facts.country !== "FR") return null;
  const { profile, legalNoticeWritten } = facts;

  const fromProfile = (
    key: LegalFieldKey,
    label: string,
    value: string | null | undefined,
  ): LegalRequirementsView["fields"][number] =>
    has(value)
      ? {
          key,
          label,
          status: "known",
          how: "In the legal profile: write it in the legal notice.",
          tools: ["settings_update_legal"],
        }
      : {
          key,
          label,
          status: "missing",
          how: "Look the company up with settings_search_company_registry, save it with settings_update_legal_profile, then write it in the legal notice.",
          tools: PROFILE_TOOLS,
        };
  const fromStore = (
    key: LegalFieldKey,
    label: string,
    value: string | null,
  ): LegalRequirementsView["fields"][number] =>
    has(value)
      ? {
          key,
          label,
          status: "known",
          how: "In the store's contact: the storefront shows it.",
          tools: ["settings_update_store_info"],
        }
      : {
          key,
          label,
          status: "missing",
          how: "Ask the user, and save it with settings_update_store_info.",
          tools: ["settings_update_store_info"],
        };
  // Louez stores neither: they live in the legal notice's text, which it cannot read.
  const inText = (
    key: LegalFieldKey,
    label: string,
    ask: string,
  ): LegalRequirementsView["fields"][number] => ({
    key,
    label,
    status: legalNoticeWritten ? "inLegalNotice" : "missing",
    how: legalNoticeWritten
      ? `Louez cannot check the legal notice's text: make sure it names ${ask}.`
      : `Ask the user for ${ask}, and write it in the legal notice (settings_update_legal).`,
    tools: ["settings_update_legal"],
  });

  const fields: LegalRequirementsView["fields"] = [
    fromProfile("legalName", "Company name", profile?.legalName),
    fromProfile("legalForm", "Legal form", profile?.legalForm),
    fromProfile("companyNumber", "SIREN or SIRET", profile?.companyNumber),
    fromProfile("registeredAddress", "Registered office", profile?.registeredAddress),
    fromStore("contactEmail", "Contact email", facts.email),
    fromStore("contactPhone", "Contact phone", facts.phone),
    inText(
      "publicationDirector",
      "Publication director",
      "the publication director (usually the legal representative)",
    ),
    facts.hostedBy === "lumycloud"
      ? {
          key: "host",
          label: "Host",
          status: "automatic",
          how: "The storefront names the host (LumyCloud) itself.",
          tools: [],
        }
      : inText("host", "Host", "the website's host (name, address, phone)"),
  ];
  const missing = fields.filter((field) => field.status === "missing");

  const gaps = [
    ...(facts.termsWritten ? [] : ["the terms of sale"]),
    ...(legalNoticeWritten ? [] : ["the legal notice"]),
  ];
  const warning =
    gaps.length === 0 && missing.length === 0
      ? null
      : `Warning: French law requires a store selling to consumers to show its terms of sale and a legal notice naming who runs it.${gaps.length > 0 ? ` Missing: ${gaps.join(" and ")}.` : ""}${missing.length > 0 ? ` The legal notice still lacks: ${missing.map((field) => field.label.toLowerCase()).join(", ")}.` : ""} The store can still go live; fill them in first if you can.`;

  return {
    country: "FR",
    audience: "consumers",
    termsWritten: facts.termsWritten,
    legalNoticeWritten,
    fields,
    missing: missing.map((field) => field.key),
    warning,
  };
}

/** The terms item's reason, in France. */
export const FRENCH_TERMS_WHY =
  "French consumer law (Code de la consommation) requires terms of sale customers can read before they book: prices, how a booking works, deposit, cancellation and withdrawal, liability. You may draft them from the store's rules and the user's answers, show them to the user, then save them with settings_update_legal.";

/** The legal notice item's reason, in France, with what Louez lacks for it. */
export function frenchLegalNoticeWhy(requirements: LegalRequirementsView): string {
  const missing = requirements.fields.filter((field) => field.status === "missing");
  return `French law (LCEN, art. 6) requires a legal notice naming the company name, legal form, SIREN or SIRET, registered office, contact email and phone, publication director and host.${
    missing.length > 0
      ? ` Missing: ${missing.map((field) => `${field.label.toLowerCase()} (${field.tools.join(", ") || "ask the user"})`).join("; ")}.`
      : ""
  } You may draft it from the legal profile (settings_get_legal_profile) and the store's contact, show it to the user, then save it with settings_update_legal.`;
}
