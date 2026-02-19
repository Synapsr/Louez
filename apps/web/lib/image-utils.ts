import sharp from 'sharp'

/**
 * Checks if a URL points to an SVG image.
 */
export function isSvgUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase()
  return (
    lowerUrl.endsWith('.svg') ||
    lowerUrl.includes('image/svg') ||
    lowerUrl.includes('content-type=image%2Fsvg')
  )
}

/**
 * Checks if a string is a data URL.
 */
export function isDataUrl(url: string): boolean {
  return url.startsWith('data:')
}

/**
 * Converts an SVG image to a PNG buffer.
 *
 * Fetches the SVG (from a remote URL or data URL),
 * converts it to PNG using sharp, and returns the raw buffer.
 *
 * Used by email (CID attachments) and PDF generation.
 *
 * @param imageUrl - SVG image URL (remote or data URL)
 * @param maxSize - Maximum width/height in pixels (default: 400)
 * @returns PNG buffer, or null if conversion fails
 */
export async function convertSvgToPngBuffer(
  imageUrl: string,
  maxSize: number = 400
): Promise<Buffer | null> {
  try {
    let imageBuffer: Buffer

    if (isDataUrl(imageUrl)) {
      const base64Matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (base64Matches) {
        imageBuffer = Buffer.from(base64Matches[2], 'base64')
      } else {
        const textMatches = imageUrl.match(/^data:([^,]+),(.+)$/)
        if (!textMatches) {
          console.warn('[Image] Invalid data URL format for SVG')
          return null
        }
        imageBuffer = Buffer.from(decodeURIComponent(textMatches[2]), 'utf-8')
      }
    } else {
      const response = await fetch(imageUrl, {
        headers: { Accept: 'image/*' },
      })

      if (!response.ok) {
        console.warn(`[Image] Failed to fetch SVG: ${response.status} ${response.statusText}`)
        return null
      }

      const arrayBuffer = await response.arrayBuffer()
      imageBuffer = Buffer.from(arrayBuffer)
    }

    return await sharp(imageBuffer)
      .resize(maxSize, maxSize, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({
        quality: 90,
        compressionLevel: 6,
      })
      .toBuffer()
  } catch (error) {
    console.error('[Image] Error converting SVG to PNG:', error)
    return null
  }
}

/**
 * Converts an SVG image to a PNG data URL.
 * Convenience wrapper over convertSvgToPngBuffer for contexts
 * that need a data URL (e.g. PDF generation).
 */
export async function convertSvgToPng(
  imageUrl: string,
  maxSize: number = 400
): Promise<string | null> {
  const buffer = await convertSvgToPngBuffer(imageUrl, maxSize)
  if (!buffer) return null
  return `data:image/png;base64,${buffer.toString('base64')}`
}
