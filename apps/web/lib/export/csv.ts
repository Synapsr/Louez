/**
 * RFC 4180 compliant CSV generator.
 *
 * - Uses CRLF line endings
 * - Escapes fields containing commas, double-quotes, or newlines
 * - Prepends UTF-8 BOM for Excel compatibility
 * - Neutralises cells a spreadsheet would run as a formula
 */

const BOM = '\uFEFF'

const FORMULA_TRIGGER = /^[=+\-@\t\r]/
const NEGATIVE_NUMBER = /^-\d+(?:\.\d+)?$/

/**
 * Exported cells carry text typed by customers and merchants. A spreadsheet
 * evaluates a cell starting with `=`, `+`, `-` or `@`: a leading apostrophe
 * makes it plain text, which also keeps the "+" of a phone number. A negative
 * amount ("-12.50") cannot carry a formula and stays a number.
 */
export function neutralizeFormula(field: string): string {
  if (!FORMULA_TRIGGER.test(field) || NEGATIVE_NUMBER.test(field)) return field
  return `'${field}`
}

function escapeField(field: string): string {
  const safe = neutralizeFormula(field)
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n') || safe.includes('\r')) {
    return `"${safe.replace(/"/g, '""')}"`
  }
  return safe
}

export function generateCsv(headers: string[], rows: string[][]): string {
  const lines = [
    headers.map(escapeField).join(','),
    ...rows.map((row) => row.map(escapeField).join(',')),
  ]
  return BOM + lines.join('\r\n')
}
