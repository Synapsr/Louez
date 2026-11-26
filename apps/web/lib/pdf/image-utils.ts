import "server-only";

import sharp, { type Metadata } from "sharp";

import { getLogoForLightBackground } from "@louez/utils";
import { MAX_IMAGE_SIZE, getStorageRelativePath } from "@louez/validations";

import { log } from "@/lib/evlog";
import { getImageFiles } from "@/lib/storage/files";

/**
 * A stored key: segments of safe characters ending in an image extension, so
 * no `..`, `%` or `\` leads it out of its folder. AVIF and SVG are there for
 * the files stored before uploads refused them.
 */
const STORED_IMAGE_KEY = /^[a-zA-Z0-9/_-]+\.(?:jpe?g|png|gif|webp|avif|svg)$/;

export type PdfImageKind = "photo" | "logo";

/** The formats each kind may be stored in, read from its bytes, and the longest side it converts to. */
const PDF_IMAGE_KINDS = {
  photo: { formats: new Set(["jpeg", "png", "webp", "gif", "avif"]), maxSide: 1600 },
  logo: { formats: new Set(["jpeg", "png", "webp", "gif", "avif", "svg"]), maxSide: 400 },
} satisfies Record<PdfImageKind, { formats: ReadonlySet<string>; maxSide: number }>;

/** The format of an image's bytes; sharp reports AVIF as a HEIF image compressed with AV1. */
const formatOf = ({ format, compression }: Metadata) =>
  format === "heif" && compression === "av1" ? "avif" : format;

const toDataUrl = (format: "jpeg" | "png", bytes: Buffer) =>
  `data:image/${format};base64,${bytes.toString("base64")}`;

/**
 * What @react-pdf/renderer can embed (JPEG and PNG only): JPEG and PNG as
 * they are, any other format the kind takes converted, a photo to JPEG and a
 * logo to PNG, which keeps its transparency. An SVG renders from its bytes
 * alone: librsvg loads none of its external references.
 */
async function toPdfImage(bytes: Buffer, kind: PdfImageKind): Promise<string | null> {
  const { formats, maxSide } = PDF_IMAGE_KINDS[kind];
  const format = formatOf(await sharp(bytes).metadata());
  if (!format || !formats.has(format)) return null;
  if (format === "jpeg" || format === "png") return toDataUrl(format, bytes);

  const resized = sharp(bytes).resize(maxSide, maxSide, {
    fit: "inside",
    withoutEnlargement: true,
  });
  return kind === "logo"
    ? toDataUrl("png", await resized.png().toBuffer())
    : toDataUrl(
        "jpeg",
        await resized.flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer(),
      );
}

const leaveOut = (key: string, reason: string) => {
  log.warn("pdf", `image ${key} left out of the document: ${reason}`);
  return null;
};

/**
 * An image of this instance's storage as a data URL for a PDF, or null when
 * it cannot be shown, which never fails the document: a key outside
 * `folder`, a missing or unreadable file, one over the upload cap, or a
 * format the kind does not take. Read by its key through the storage
 * adapter, the same in every storage mode: no URL is ever fetched.
 */
export async function readStoredImageForPdf(
  key: string,
  folder: string,
  kind: PdfImageKind,
): Promise<string | null> {
  if (!key.startsWith(`${folder}/`) || !STORED_IMAGE_KEY.test(key)) {
    return leaveOut(key, `not a key of ${folder}`);
  }

  try {
    // One byte past the cap: a file that fills the range is over it.
    const file = await getImageFiles().download(key, {
      range: { start: 0, end: MAX_IMAGE_SIZE },
    });
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_SIZE) return leaveOut(key, "over the size cap");

    return (await toPdfImage(bytes, kind)) ?? leaveOut(key, `not a ${kind} format`);
  } catch (error) {
    return leaveOut(key, error instanceof Error ? error.message : String(error));
  }
}

/**
 * The logo a PDF shows on its light background, read from the store's own
 * logo folder. Null for a logo stored anywhere else: the PDF then shows the
 * store's name.
 */
export async function readStoreLogoForPdf(
  store: Parameters<typeof getLogoForLightBackground>[0] & { id: string },
): Promise<string | null> {
  const url = getLogoForLightBackground(store);
  const key = url ? getStorageRelativePath(url) : null;
  return key ? readStoredImageForPdf(key, `${store.id}/logo`, "logo") : null;
}
