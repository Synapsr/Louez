/**
 * RFC 4180 compliant CSV generator.
 *
 * - Uses CRLF line endings
 * - Escapes fields containing commas, double-quotes, or newlines
 * - Prepends UTF-8 BOM for Excel compatibility
 */

const BOM = '\uFEFF'

function escapeField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}

export function generateCsv(headers: string[], rows: string[][]): string {
  const lines = [
    headers.map(escapeField).join(','),
    ...rows.map((row) => row.map(escapeField).join(',')),
  ]
  return BOM + lines.join('\r\n')
}
