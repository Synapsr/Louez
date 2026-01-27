import { isSvgUrl, convertSvgToPng } from '@/lib/image-utils'

/**
 * Converts an image URL to a format compatible with @react-pdf/renderer.
 * SVG images are converted to PNG since react-pdf doesn't support SVG.
 *
 * @param imageUrl - The URL of the image (can be a remote URL or data URL)
 * @param maxSize - Maximum width/height for the output image (default: 400px)
 * @returns A Promise resolving to a PNG data URL, or null if conversion fails
 */
export async function convertImageForPdf(
  imageUrl: string | null | undefined,
  maxSize: number = 400
): Promise<string | null> {
  if (!imageUrl) {
    return null
  }

  // If it's not an SVG, return the original URL
  // react-pdf supports PNG, JPG, and other raster formats natively
  if (!isSvgUrl(imageUrl)) {
    return imageUrl
  }

  return convertSvgToPng(imageUrl, maxSize)
}
