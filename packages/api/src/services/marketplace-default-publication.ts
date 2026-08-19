import type {
  MarketplaceDefaultPublicationCandidate,
  MarketplacePublicationChecklist,
} from "./marketplace-channel";

export interface MarketplaceDefaultPublicationResult {
  enabled: boolean;
  candidates: number;
  ownerDecidedSkipped: number;
  nonConformingSkipped: number;
  published: number;
  unchanged: number;
  publications: Array<{ storeId: string; cohortRank: number | null }>;
  errors: Array<{ storeId: string; error: string }>;
}

interface MarketplaceDefaultPublicationChannel {
  ownerDecidedAt: string | null;
  status: "setup_required" | "pending" | "published" | "paused" | "disabled";
  termsAcceptedAt: string | null;
  consentBasis: "explicit" | "terms_update";
  statusReason: string | null;
  cohortRank: number | null;
}

export interface MarketplaceDefaultPublicationDependencies {
  listCandidates: () => Promise<MarketplaceDefaultPublicationCandidate[]>;
  evaluateChecklist: (storeId: string) => Promise<MarketplacePublicationChecklist>;
  publish: (storeId: string) => Promise<{ channel: MarketplaceDefaultPublicationChannel | null }>;
}

async function createDefaultDependencies(
  launchCohortSize: number,
): Promise<MarketplaceDefaultPublicationDependencies> {
  const {
    enableMarketplaceChannel,
    evaluateMarketplaceChecklist,
    listMarketplaceDefaultPublicationCandidates,
  } = await import("./marketplace-channel");

  return {
    listCandidates: listMarketplaceDefaultPublicationCandidates,
    evaluateChecklist: (storeId) =>
      evaluateMarketplaceChecklist({
        storeId,
        termsAcceptedAt: null,
        consentBasis: "terms_update",
      }),
    publish: (storeId) =>
      enableMarketplaceChannel({
        source: "default_publication",
        storeId,
        launchCohortSize,
      }),
  };
}

/**
 * Publishes checklist-conforming stores only after the production gate is enabled.
 * Re-runs are safe: published/owner-decided channels are excluded or re-checked by
 * the shared channel transaction before any write is made.
 */
export async function runMarketplaceDefaultPublication(
  options: {
    enabled: boolean;
    launchCohortSize: number;
  },
  dependencies?: MarketplaceDefaultPublicationDependencies,
): Promise<MarketplaceDefaultPublicationResult> {
  const result: MarketplaceDefaultPublicationResult = {
    enabled: options.enabled,
    candidates: 0,
    ownerDecidedSkipped: 0,
    nonConformingSkipped: 0,
    published: 0,
    unchanged: 0,
    publications: [],
    errors: [],
  };
  if (!options.enabled) return result;

  const resolvedDependencies =
    dependencies ?? (await createDefaultDependencies(options.launchCohortSize));
  const candidates = await resolvedDependencies.listCandidates();
  result.candidates = candidates.length;

  for (const candidate of candidates) {
    if (candidate.ownerDecidedAt !== null) {
      result.ownerDecidedSkipped += 1;
      continue;
    }

    try {
      const checklist = await resolvedDependencies.evaluateChecklist(candidate.storeId);
      if (!checklist.complete) {
        result.nonConformingSkipped += 1;
        continue;
      }

      const state = await resolvedDependencies.publish(candidate.storeId);
      const channel = state.channel;
      if (channel?.ownerDecidedAt) {
        result.ownerDecidedSkipped += 1;
        continue;
      }
      if (
        channel?.status !== "published" ||
        channel.consentBasis !== "terms_update" ||
        channel.termsAcceptedAt !== null ||
        channel.statusReason !== "default_publication"
      ) {
        result.unchanged += 1;
        continue;
      }

      result.published += 1;
      result.publications.push({ storeId: candidate.storeId, cohortRank: channel.cohortRank });
    } catch (error) {
      result.errors.push({
        storeId: candidate.storeId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
