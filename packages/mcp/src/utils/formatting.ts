/**
 * Format a monetary amount in EUR.
 * Uses a standard English format (€25.00) for consistent LLM consumption.
 */
export function formatCurrency(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
  }).format(num)
}

/**
 * Format a date for display (ISO YYYY-MM-DD).
 */
export function formatDate(date: Date | string | null): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toISOString().slice(0, 10)
}

/**
 * Format a date with time (YYYY-MM-DD HH:MM).
 */
export function formatDateTime(date: Date | string | null): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`
}

/**
 * Format a reservation status for display.
 * Returns the English status with first letter capitalized.
 */
export function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}
