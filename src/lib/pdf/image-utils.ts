import sharp from 'sharp'

/**
 * Checks if a URL points to an SVG image
 */
function isSvgUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase()
  return (
    lowerUrl.endsWith('.svg') ||
    lowerUrl.includes('image/svg') ||
    lowerUrl.includes('content-type=image%2Fsvg')
  )
}

/**
 * Checks if a string is a data URL
 */
function isDataUrl(url: string): boolean {
  return url.startsWith('data:')
}

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

  try {
    // If it's not an SVG, return the original URL
    // react-pdf supports PNG, JPG, and other raster formats natively
    if (!isSvgUrl(imageUrl)) {
      return imageUrl
    }

    let imageBuffer: Buffer

    if (isDataUrl(imageUrl)) {
      // Handle data URL (e.g., data:image/svg+xml;base64,...)
      const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (!matches) {
        // Try non-base64 data URL
        const textMatches = imageUrl.match(/^data:([^,]+),(.+)$/)
        if (!textMatches) {
          console.warn('[PDF] Invalid data URL format for image')
          return null
        }
        // URL-decode the content
        const svgContent = decodeURIComponent(textMatches[2])
        imageBuffer = Buffer.from(svgContent, 'utf-8')
      } else {
        imageBuffer = Buffer.from(matches[2], 'base64')
      }
    } else {
      // Fetch remote URL
      const response = await fetch(imageUrl, {
        headers: {
          Accept: 'image/*',
        },
      })

      if (!response.ok) {
        console.warn(`[PDF] Failed to fetch image: ${response.status} ${response.statusText}`)
        return null
      }

      const arrayBuffer = await response.arrayBuffer()
      imageBuffer = Buffer.from(arrayBuffer)
    }

    // Convert SVG to PNG using sharp
    const pngBuffer = await sharp(imageBuffer)
      .resize(maxSize, maxSize, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({
        quality: 90,
        compressionLevel: 6,
      })
      .toBuffer()

    // Return as data URL
    return `data:image/png;base64,${pngBuffer.toString('base64')}`
  } catch (error) {
    console.error('[PDF] Error converting image:', error)
    return null
  }
}
