import type {
  ProductImageHistory,
  ProductImageVersion,
  ProductImageVersionKind,
} from "@louez/types";

/**
 * A product photo's versions (its lineage), as `products.image_history`
 * keeps them, and the rules of the AI photo operations. Pure functions: the
 * dashboard's form and the API's image jobs (packages/api
 * services/product-images.ts) use the same ones.
 *
 * A lineage is one logical photo: its original, then each crop, AI
 * enhancement or background removal. `products.images` holds the version in
 * use for each photo; the others stay in the lineage, so any of them can be
 * used again.
 */

/** Most versions one lineage keeps. */
export const PRODUCT_IMAGE_VERSIONS_MAX = 50;

const randomSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createHistoryId = () => `product-image-history-${randomSuffix()}`;

const createVersion = (
  url: string,
  kind: ProductImageVersionKind,
  options: { id?: string; createdAt?: string } = {},
): ProductImageVersion => ({
  id: options.id ?? `product-image-version-${randomSuffix()}`,
  url,
  kind,
  createdAt: options.createdAt ?? new Date().toISOString(),
});

/**
 * The lineages with one added for each image that has none yet: an
 * `original` alone, with ids that depend only on the images and the stored
 * lineages, so reading twice gives the same ids.
 */
export const createInitialProductImageHistory = (
  images: string[],
  histories: ProductImageHistory[] = [],
): ProductImageHistory[] => {
  const claimedUrls = new Set(
    histories.flatMap((history) => history.versions.map(({ url }) => url)),
  );
  const claimedHistoryIds = new Set(histories.map(({ id }) => id));
  const claimedVersionIds = new Set(
    histories.flatMap((history) => history.versions.map(({ id }) => id)),
  );
  let initialSequence = 1;
  const missingHistories = images.flatMap<ProductImageHistory>((url) => {
    if (claimedUrls.has(url)) return [];

    while (
      claimedHistoryIds.has(`product-image-history-initial-${initialSequence}`) ||
      claimedVersionIds.has(`product-image-version-initial-${initialSequence}`)
    ) {
      initialSequence += 1;
    }
    const historyId = `product-image-history-initial-${initialSequence}`;
    const versionId = `product-image-version-initial-${initialSequence}`;
    claimedHistoryIds.add(historyId);
    claimedVersionIds.add(versionId);
    initialSequence += 1;

    return [
      {
        id: historyId,
        versions: [
          {
            id: versionId,
            url,
            kind: "original",
          },
        ],
      },
    ];
  });

  return [...histories, ...missingHistories];
};

export const findProductImageHistory = (
  histories: ProductImageHistory[],
  imageUrl: string,
): ProductImageHistory | null =>
  histories.find((history) => history.versions.some(({ url }) => url === imageUrl)) ?? null;

export const addProductImageHistory = (
  histories: ProductImageHistory[],
  imageUrl: string,
): ProductImageHistory[] => {
  if (findProductImageHistory(histories, imageUrl)) return histories;

  return [
    ...histories,
    {
      id: createHistoryId(),
      versions: [createVersion(imageUrl, "original")],
    },
  ];
};

/**
 * Ids and date of what `appendProductImageVersion` adds, when the caller
 * names them (an image job names them after itself, so it can say them
 * before it runs). Random ids and the current time otherwise.
 */
export interface ProductImageVersionIds {
  /** The new version. */
  versionId?: string;
  /** The lineage made when the source had none. */
  historyId?: string;
  /** The source's `original` version, in a lineage made for it. */
  sourceVersionId?: string;
  createdAt?: string;
}

export const appendProductImageVersion = (
  histories: ProductImageHistory[],
  sourceUrl: string,
  nextUrl: string,
  kind: ProductImageVersionKind,
  ids: ProductImageVersionIds = {},
): ProductImageHistory[] => {
  const sourceHistory = findProductImageHistory(histories, sourceUrl);
  const nextVersion = createVersion(nextUrl, kind, { id: ids.versionId, createdAt: ids.createdAt });

  if (!sourceHistory) {
    return [
      ...histories,
      {
        id: ids.historyId ?? createHistoryId(),
        versions: [
          createVersion(sourceUrl, "original", {
            id: ids.sourceVersionId,
            createdAt: ids.createdAt,
          }),
          nextVersion,
        ],
      },
    ];
  }

  if (sourceHistory.versions.some(({ url }) => url === nextUrl)) return histories;

  return histories.map((history) =>
    history.id === sourceHistory.id
      ? { ...history, versions: [...history.versions, nextVersion] }
      : history,
  );
};

export const removeProductImageHistory = (
  histories: ProductImageHistory[],
  imageUrl: string,
): ProductImageHistory[] => {
  const history = findProductImageHistory(histories, imageUrl);
  return history ? histories.filter(({ id }) => id !== history.id) : histories;
};

export const removeProductImageVersion = (
  histories: ProductImageHistory[],
  historyId: string,
  versionId: string,
): ProductImageHistory[] =>
  histories.map((history) => {
    if (history.id !== historyId || history.versions.length <= 1) return history;

    return {
      ...history,
      versions: history.versions.filter(({ id }) => id !== versionId),
    };
  });

export const collectProductImageUrls = (
  images: string[],
  histories: ProductImageHistory[],
): string[] =>
  Array.from(
    new Set([...images, ...histories.flatMap((history) => history.versions.map(({ url }) => url))]),
  );

/**
 * The index in `images` of the photo a lineage belongs to: the first image
 * that is one of its versions, or -1 when none is in use (the photo was
 * removed from the product).
 */
export const productImageSlot = (images: string[], history: ProductImageHistory): number => {
  const urls = new Set(history.versions.map(({ url }) => url));
  return images.findIndex((url) => urls.has(url));
};

/** One photo of a product and its versions, as the API shows them. */
export interface ProductImageVersionsView {
  /** The version in use, as `images` holds it. */
  imageUrl: string;
  versions: Array<{
    id: string;
    url: string;
    kind: ProductImageVersionKind;
    createdAt: string | null;
    /** The version in use. */
    current: boolean;
  }>;
}

/**
 * Each photo of `images`, in order, with its versions: its stored lineage,
 * or an `original` alone (`createInitialProductImageHistory`'s ids) for a
 * photo that has none.
 */
export const productImageVersions = (
  images: string[],
  histories: ProductImageHistory[],
): ProductImageVersionsView[] => {
  const all = createInitialProductImageHistory(images, histories);
  return images.map((imageUrl) => ({
    imageUrl,
    // Every image has a lineage in `all`, its own or one made for it.
    versions: (findProductImageHistory(all, imageUrl)?.versions ?? []).map((version) => ({
        id: version.id,
        url: version.url,
        kind: version.kind,
        createdAt: version.createdAt ?? null,
      current: version.url === imageUrl,
    })),
  }));
};

/** What `selectProductImageVersion` changes, or why it cannot. */
export type SelectProductImageVersionResult =
  | { ok: true; images: string[]; previousUrl: string; url: string }
  | { ok: false; reason: "version_not_found" | "photo_not_in_use" };

/**
 * Puts a version in use: it takes the place of its photo in `images`. Using
 * the version already in use changes nothing.
 */
export const selectProductImageVersion = (
  images: string[],
  histories: ProductImageHistory[],
  versionId: string,
): SelectProductImageVersionResult => {
  const all = createInitialProductImageHistory(images, histories);
  const history = all.find((entry) => entry.versions.some(({ id }) => id === versionId));
  const version = history?.versions.find(({ id }) => id === versionId);
  if (!history || !version) return { ok: false, reason: "version_not_found" };
  const slot = productImageSlot(images, history);
  if (slot === -1) return { ok: false, reason: "photo_not_in_use" };
  const next = [...images];
  const previousUrl = next[slot] ?? version.url;
  next[slot] = version.url;
  return { ok: true, images: next, previousUrl, url: version.url };
};

// --- AI photo operations -------------------------------------------------------

export type ProductImageProcessingKind = "ai-enhanced" | "background-removed";
export type ProductImageProcessingOperation = "enhance" | "remove-background";

/** The file name of a stored image URL (absolute, or site-relative such as `/files/…`). */
export const getImageKeyFromUrl = (url: string | null | undefined) => {
  if (!url) return null;
  if (!url.includes("://") && !url.startsWith("/")) return null;

  try {
    // The base makes site-relative asset URLs ("/files/…", standalone
    // deployments) parse like the absolute bucket URLs of platform mode.
    const pathname = new URL(url, "https://placeholder.invalid").pathname;
    const filename = pathname.split("/").filter(Boolean).at(-1);
    return filename ? decodeURIComponent(filename) : null;
  } catch {
    return null;
  }
};

/** What an AI operation made of an image, read from its file name (`-ai.webp`, `-bg.webp`). */
export const getProductImageProcessingKind = (
  url: string | null | undefined,
): ProductImageProcessingKind | null => {
  const key = getImageKeyFromUrl(url)?.toLowerCase();
  if (key?.endsWith("-ai.webp")) return "ai-enhanced";
  if (key?.endsWith("-bg.webp")) return "background-removed";
  return null;
};

export const canApplyProductImageOperation = (
  url: string | null | undefined,
  operation: ProductImageProcessingOperation,
): boolean => {
  const processingKind = getProductImageProcessingKind(url);
  if (!processingKind) return true;

  // A background-only result may still deliberately be upgraded with GPT
  // Image. Every other repeat would only redo work already present.
  return operation === "enhance" && processingKind === "background-removed";
};

/** The version kind an operation's result is recorded as. */
export const productImageVersionKindOf = (
  operation: ProductImageProcessingOperation,
): ProductImageVersionKind => (operation === "enhance" ? "ai-enhanced" : "background-removed");
