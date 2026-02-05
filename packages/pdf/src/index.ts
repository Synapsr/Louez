/**
 * @louez/pdf
 *
 * PDF generation for contracts and inspections.
 *
 * NOTE: PDF implementation remains in apps/web/lib/pdf/ for now
 * due to dependencies on database and i18n messages.
 *
 * This package can be fully extracted in a future iteration when:
 * - PDF templates can receive i18n messages as props
 * - Database queries are passed as props instead of fetched internally
 *
 * For now, import PDF functionality directly from the app:
 * import { generateContractPdf } from '@/lib/pdf'
 */

export {}
