import { z } from "zod";

import { log } from "@/lib/evlog";

/**
 * Client for the French public company registry
 * (https://recherche-entreprises.api.gouv.fr — free, no API key, no quota key).
 *
 * Called from server actions only: the API rejects browser origins and rate
 * limits per IP, so proxying keeps the storefront off its quota.
 */
const SEARCH_ENDPOINT = "https://recherche-entreprises.api.gouv.fr/search";
const SEARCH_TIMEOUT_MS = 6000;
const MAX_RESULTS = 8;

/** A registry match, already flattened into the shape the legal-identity form fills. */
export interface CompanySearchResult {
  siren: string;
  siret: string;
  legalName: string;
  legalForm: string;
  vatNumber: string;
  address: string;
  addressComplement: string;
  postalCode: string;
  city: string;
  rcsCity: string;
  isActive: boolean;
}

/** Only the fields we read — the registry returns many more and adds new ones. */
const nullableString = z.string().nullish();

const registryEstablishmentSchema = z.object({
  adresse: nullableString,
  code_postal: nullableString,
  complement_adresse: nullableString,
  indice_repetition: nullableString,
  libelle_commune: nullableString,
  libelle_voie: nullableString,
  numero_voie: nullableString,
  siret: nullableString,
  type_voie: nullableString,
});

const registryCompanySchema = z.object({
  etat_administratif: nullableString,
  nature_juridique: nullableString,
  nom_complet: nullableString,
  nom_raison_sociale: nullableString,
  siege: registryEstablishmentSchema.nullish(),
  sigle: nullableString,
  siren: nullableString,
});

const registrySearchResponseSchema = z.object({
  results: z.array(registryCompanySchema).nullish(),
});

type RegistryEstablishment = z.infer<typeof registryEstablishmentSchema>;
type RegistryCompany = z.infer<typeof registryCompanySchema>;

/**
 * INSEE "catégorie juridique" labels, keyed by the 2-digit family of the code.
 * Exact codes that merchants recognise by their acronym override the family.
 */
const LEGAL_FORM_BY_CODE: Record<string, string> = {
  "1000": "Entrepreneur individuel",
  "5202": "SNC",
  "5306": "SCS",
  "5308": "SCA",
  "5410": "SARL unipersonnelle",
  "5498": "SARL",
  "5499": "SARL",
  "5505": "SA",
  "5599": "SA",
  "5699": "SA à directoire",
  "5710": "SAS",
  "5720": "SASU",
  "6220": "GIE",
  "6540": "SCI",
  "9220": "Association déclarée",
};

const LEGAL_FORM_BY_FAMILY: Record<string, string> = {
  "10": "Entrepreneur individuel",
  "21": "Indivision",
  "22": "Société créée de fait",
  "23": "Société en participation",
  "31": "Société étrangère immatriculée au RCS",
  "32": "Société étrangère non immatriculée au RCS",
  "51": "Société coopérative",
  "52": "Société en nom collectif",
  "53": "Société en commandite",
  "54": "SARL",
  "55": "SA à conseil d'administration",
  "56": "SA à directoire",
  "57": "SAS",
  "58": "Société européenne",
  "62": "Groupement d'intérêt économique",
  "63": "Société coopérative agricole",
  "64": "Société d'assurance mutuelle",
  "65": "Société civile",
  "69": "Autre personne morale de droit privé",
  "92": "Association déclarée",
  "93": "Fondation",
};

const resolveLegalForm = (natureJuridique: string | null | undefined): string => {
  if (!natureJuridique) return "";
  return (
    LEGAL_FORM_BY_CODE[natureJuridique] ?? LEGAL_FORM_BY_FAMILY[natureJuridique.slice(0, 2)] ?? ""
  );
};

/**
 * Intra-community VAT number of a French company: `FR` + 2-digit key + SIREN,
 * key = (12 + 3 × (SIREN mod 97)) mod 97.
 */
const buildFrenchVatNumber = (siren: string): string => {
  if (!/^\d{9}$/.test(siren)) return "";
  const key = (12 + 3 * (Number(siren) % 97)) % 97;
  return `FR${String(key).padStart(2, "0")}${siren}`;
};

/** Street line rebuilt from its parts, falling back to the flat `adresse` field. */
const buildStreetLine = (establishment: RegistryEstablishment): string => {
  const parts = [
    establishment.numero_voie,
    establishment.indice_repetition,
    establishment.type_voie,
    establishment.libelle_voie,
  ].filter((part): part is string => Boolean(part && part.trim().length > 0));

  if (parts.length > 0) return parts.join(" ");

  // `adresse` is "<street> <postal code> <city>" — strip the trailing locality.
  const flat = establishment.adresse?.trim() ?? "";
  const postalCode = establishment.code_postal?.trim() ?? "";
  if (!flat || !postalCode) return flat;
  const index = flat.indexOf(postalCode);
  return index > 0 ? flat.slice(0, index).trim() : flat;
};

const toSearchResult = (company: RegistryCompany): CompanySearchResult | null => {
  const siren = company.siren?.trim() ?? "";
  if (!siren) return null;

  const establishment = company.siege ?? {};
  const city = establishment.libelle_commune?.trim() ?? "";

  return {
    siren,
    siret: establishment.siret?.trim() ?? "",
    legalName: (company.nom_raison_sociale || company.nom_complet || company.sigle || "").trim(),
    legalForm: resolveLegalForm(company.nature_juridique),
    vatNumber: buildFrenchVatNumber(siren),
    address: buildStreetLine(establishment),
    addressComplement: establishment.complement_adresse?.trim() ?? "",
    postalCode: establishment.code_postal?.trim() ?? "",
    city,
    // The registry exposes no greffe; the head-office city is the usual RCS city.
    rcsCity: city,
    isActive: company.etat_administratif === "A",
  };
};

/**
 * Search French companies by name, SIREN or SIRET.
 *
 * Returns an empty list on any failure — the merchant can always type the
 * legal identity manually, so a registry outage must not block the form.
 */
export const searchFrenchCompanies = async (query: string): Promise<CompanySearchResult[]> => {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("page", "1");
  url.searchParams.set("per_page", String(MAX_RESULTS));
  url.searchParams.set("minimal", "true");
  url.searchParams.set("include", "siege");

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      log.warn("recherche-entreprises", `search failed with status ${response.status}`);
      return [];
    }

    const payload = registrySearchResponseSchema.safeParse(await response.json());

    if (!payload.success) {
      log.warn("recherche-entreprises", "search returned an unexpected payload shape");
      return [];
    }

    return (payload.data.results ?? [])
      .map(toSearchResult)
      .filter((result): result is CompanySearchResult => result !== null);
  } catch (error) {
    log.error(
      "recherche-entreprises",
      `search unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
};
