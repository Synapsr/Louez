/**
 * Color utility functions for contrast detection and accessibility
 */

/**
 * Calculates the relative luminance of a hex color and returns
 * the appropriate contrasting text color (black or white).
 *
 * Uses the WCAG luminance formula:
 * L = 0.299 * R + 0.587 * G + 0.114 * B
 *
 * @param hexColor - A hex color string (with or without #)
 * @returns 'black' or 'white' for optimal text contrast
 */
export function getContrastColor(hexColor: string): 'black' | 'white' {
  // Remove # if present and handle shorthand hex
  const hex = hexColor.replace('#', '')

  // Handle shorthand hex (e.g., #FFF -> #FFFFFF)
  const fullHex = hex.length === 3
    ? hex.split('').map(c => c + c).join('')
    : hex

  const r = parseInt(fullHex.slice(0, 2), 16)
  const g = parseInt(fullHex.slice(2, 4), 16)
  const b = parseInt(fullHex.slice(4, 6), 16)

  // WCAG luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

  // Return white for dark colors, black for light colors
  return luminance > 0.5 ? 'black' : 'white'
}

/**
 * Returns the hex color code for the contrast color
 * @param hexColor - A hex color string (with or without #)
 * @returns '#000000' or '#ffffff'
 */
export function getContrastColorHex(hexColor: string): '#000000' | '#ffffff' {
  return getContrastColor(hexColor) === 'black' ? '#000000' : '#ffffff'
}
