import { StyleSheet } from '@react-pdf/renderer'

// Helper to convert hex to rgba for lighter tints
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Get a lighter version of a color for backgrounds (very subtle)
export function getLighterColor(hex: string, intensity: number = 0.08): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lightR = Math.round(r * intensity + 255 * (1 - intensity))
  const lightG = Math.round(g * intensity + 255 * (1 - intensity))
  const lightB = Math.round(b * intensity + 255 * (1 - intensity))
  return `rgb(${lightR}, ${lightG}, ${lightB})`
}

// Get contrasting text color (white or dark)
// Uses threshold of 0.55 to favor white text on medium-dark colors
export function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.55 ? '#1a1a1a' : '#ffffff'
}

// Create dynamic styles based on primary color
export function createContractStyles(primaryColor: string = '#0066FF') {
  const lightBg = getLighterColor(primaryColor, 0.06)
  const contrastColor = getContrastColor(primaryColor)

  return StyleSheet.create({
    // Page
    page: {
      paddingTop: 50,
      paddingBottom: 70,
      paddingHorizontal: 40,
      fontSize: 9,
      fontFamily: 'Helvetica',
      color: '#2d2d2d',
      lineHeight: 1.5,
    },

    // Header accent bar
    headerBar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 6,
      backgroundColor: primaryColor,
    },

    // Header
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 25,
      paddingBottom: 15,
      borderBottomWidth: 1,
      borderBottomColor: '#e5e5e5',
    },
    logoContainer: {
      flexDirection: 'column',
      justifyContent: 'center',
      maxWidth: '50%',
      minHeight: 70,
    },
    logo: {
      maxWidth: 180,
      maxHeight: 70,
      objectFit: 'contain',
    },
    storeName: {
      fontSize: 20,
      fontFamily: 'Helvetica-Bold',
      color: '#1a1a1a',
    },
    headerRight: {
      flexDirection: 'column',
      alignItems: 'flex-end',
    },
    documentTypeContainer: {
      backgroundColor: primaryColor,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 4,
      marginBottom: 8,
    },
    documentType: {
      fontSize: 11,
      fontFamily: 'Helvetica-Bold',
      color: contrastColor,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    documentInfo: {
      textAlign: 'right',
    },
    documentNumber: {
      fontSize: 10,
      fontFamily: 'Helvetica-Bold',
      color: '#1a1a1a',
      marginBottom: 2,
    },
    documentDate: {
      fontSize: 9,
      color: '#666666',
    },

    // Parties section
    partiesContainer: {
      flexDirection: 'row',
      marginBottom: 20,
      gap: 15,
    },
    partyCard: {
      flex: 1,
      backgroundColor: '#fafafa',
      borderRadius: 4,
      padding: 12,
      borderLeftWidth: 3,
      borderLeftColor: primaryColor,
    },
    partyLabel: {
      fontSize: 8,
      fontFamily: 'Helvetica-Bold',
      color: '#666666',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    partyName: {
      fontSize: 10,
      fontFamily: 'Helvetica-Bold',
      color: '#1a1a1a',
      marginBottom: 3,
    },
    partyInfo: {
      fontSize: 8,
      color: '#444444',
      marginBottom: 1,
    },
    partyLegal: {
      fontSize: 7,
      color: '#888888',
      marginTop: 4,
    },

    // Period section
    periodSection: {
      marginBottom: 18,
    },
    sectionTitle: {
      fontSize: 9,
      fontFamily: 'Helvetica-Bold',
      color: '#1a1a1a',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 8,
      paddingBottom: 4,
      borderBottomWidth: 1,
      borderBottomColor: '#eeeeee',
    },
    periodContainer: {
      flexDirection: 'row',
      gap: 12,
    },
    periodCard: {
      flex: 1,
      backgroundColor: lightBg,
      borderRadius: 4,
      padding: 10,
      flexDirection: 'row',
      alignItems: 'center',
    },
    periodIconCircle: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: primaryColor,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 10,
    },
    periodIconText: {
      fontSize: 10,
      fontFamily: 'Helvetica-Bold',
      color: contrastColor,
    },
    periodContent: {
      flex: 1,
    },
    periodLabel: {
      fontSize: 7,
      color: '#666666',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
      marginBottom: 1,
    },
    periodDate: {
      fontSize: 9,
      fontFamily: 'Helvetica-Bold',
      color: '#1a1a1a',
    },
    periodTime: {
      fontSize: 8,
      color: '#555555',
    },

    // Table section
    tableSection: {
      marginBottom: 15,
    },
    table: {
      borderWidth: 1,
      borderColor: '#e0e0e0',
      borderRadius: 4,
    },
    tableHeader: {
      flexDirection: 'row',
      backgroundColor: '#f5f5f5',
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#e0e0e0',
    },
    tableHeaderCell: {
      fontSize: 8,
      fontFamily: 'Helvetica-Bold',
      color: '#444444',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    tableRow: {
      flexDirection: 'row',
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#f0f0f0',
    },
    tableRowAlt: {
      backgroundColor: '#fafafa',
    },
    tableRowLast: {
      borderBottomWidth: 0,
    },
    tableCell: {
      fontSize: 9,
      color: '#333333',
    },
    tableCellName: {
      flex: 4,
    },
    tableCellQty: {
      flex: 1,
      textAlign: 'center',
    },
    tableCellPrice: {
      flex: 1.5,
      textAlign: 'right',
    },
    tableCellTotal: {
      flex: 1.5,
      textAlign: 'right',
    },
    unitIdentifiers: {
      fontSize: 7.5,
      color: '#666666',
      fontStyle: 'italic',
      marginTop: 2,
    },

    // Totals
    totalsContainer: {
      marginTop: 10,
      alignItems: 'flex-end',
    },
    totalsBox: {
      width: 220,
      borderWidth: 1,
      borderColor: '#e0e0e0',
      borderRadius: 4,
      overflow: 'hidden',
    },
    totalRow: {
      flexDirection: 'row',
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderBottomWidth: 1,
      borderBottomColor: '#f0f0f0',
    },
    totalRowLast: {
      borderBottomWidth: 0,
    },
    totalLabel: {
      flex: 1,
      fontSize: 9,
      color: '#555555',
    },
    totalValue: {
      fontSize: 9,
      fontFamily: 'Helvetica-Bold',
      color: '#333333',
      textAlign: 'right',
    },
    totalRowMain: {
      backgroundColor: primaryColor,
      borderBottomWidth: 0,
    },
    totalLabelMain: {
      flex: 1,
      fontSize: 10,
      fontFamily: 'Helvetica-Bold',
      color: contrastColor,
    },
    totalValueMain: {
      fontSize: 10,
      fontFamily: 'Helvetica-Bold',
      color: contrastColor,
      textAlign: 'right',
    },
    depositRow: {
      backgroundColor: '#fffbeb',
    },
    depositLabel: {
      flex: 1,
      fontSize: 9,
      color: '#92400e',
    },
    depositValue: {
      fontSize: 9,
      fontFamily: 'Helvetica-Bold',
      color: '#92400e',
      textAlign: 'right',
    },

    // Payments section
    paymentsSection: {
      marginBottom: 15,
    },
    paymentsList: {
      borderWidth: 1,
      borderColor: '#e0e0e0',
      borderRadius: 4,
    },
    paymentRow: {
      flexDirection: 'row',
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderBottomWidth: 1,
      borderBottomColor: '#f0f0f0',
      alignItems: 'center',
    },
    paymentRowLast: {
      borderBottomWidth: 0,
    },
    paymentStatus: {
      fontSize: 8,
      fontFamily: 'Helvetica-Bold',
      marginRight: 10,
      width: 55,
    },
    paymentStatusCompleted: {
      color: '#16a34a',
    },
    paymentStatusPending: {
      color: '#d97706',
    },
    paymentDetails: {
      flex: 1,
    },
    paymentType: {
      fontSize: 9,
      fontFamily: 'Helvetica-Bold',
      color: '#333333',
    },
    paymentMethod: {
      fontSize: 8,
      color: '#666666',
    },
    paymentDate: {
      fontSize: 8,
      color: '#888888',
      marginRight: 10,
    },
    paymentAmount: {
      fontSize: 9,
      fontFamily: 'Helvetica-Bold',
      color: '#16a34a',
    },
    paymentAmountPending: {
      color: '#d97706',
    },
    noPayments: {
      padding: 12,
      fontSize: 8,
      color: '#888888',
      fontStyle: 'italic',
      textAlign: 'center',
    },
    paymentSummary: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingTop: 8,
      marginTop: 8,
      borderTopWidth: 1,
      borderTopColor: '#e0e0e0',
    },
    paymentSummaryItem: {
      marginLeft: 20,
    },
    paymentSummaryLabel: {
      fontSize: 8,
      color: '#666666',
    },
    paymentSummaryValue: {
      fontSize: 10,
      fontFamily: 'Helvetica-Bold',
      color: '#333333',
    },
    paymentSummaryValueSuccess: {
      color: '#16a34a',
    },
    paymentSummaryValueWarning: {
      color: '#d97706',
    },

    // Conditions section
    conditionsSection: {
      marginBottom: 15,
    },
    conditionsList: {
      backgroundColor: '#fafafa',
      borderRadius: 4,
      padding: 12,
    },
    conditionItem: {
      flexDirection: 'row',
      marginBottom: 4,
    },
    conditionBullet: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: primaryColor,
      marginRight: 8,
      marginTop: 4,
    },
    conditionText: {
      flex: 1,
      fontSize: 8,
      color: '#555555',
      lineHeight: 1.4,
    },

    // Signatures section
    signaturesSection: {
      marginTop: 15,
    },
    signaturesContainer: {
      flexDirection: 'row',
      gap: 15,
    },
    signatureBox: {
      flex: 1,
      backgroundColor: lightBg,
      borderRadius: 4,
      padding: 12,
      borderWidth: 1,
      borderColor: primaryColor,
      borderLeftWidth: 3,
    },
    signatureHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: '#e5e5e5',
    },
    signatureTitle: {
      fontSize: 9,
      fontFamily: 'Helvetica-Bold',
      color: '#333333',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    signatureStatusText: {
      fontSize: 8,
      fontFamily: 'Helvetica-Bold',
      color: '#16a34a',
    },
    signatureContent: {
      marginTop: 6,
    },
    signatureText: {
      fontSize: 7,
      color: '#666666',
      marginBottom: 8,
      lineHeight: 1.4,
    },
    signatureDateRow: {
      flexDirection: 'row',
      marginBottom: 2,
    },
    signatureDateLabel: {
      fontSize: 7,
      color: '#666666',
      width: 45,
    },
    signatureDate: {
      fontSize: 7,
      fontFamily: 'Helvetica-Bold',
      color: '#333333',
      flex: 1,
    },
    signatureIp: {
      fontSize: 7,
      color: '#999999',
      marginTop: 4,
    },

    // Legal mentions
    legalSection: {
      marginTop: 15,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: '#eeeeee',
    },
    legalText: {
      fontSize: 7,
      color: '#888888',
      lineHeight: 1.4,
      marginBottom: 2,
    },
    legalTitle: {
      fontSize: 7,
      fontFamily: 'Helvetica-Bold',
      color: '#666666',
      marginBottom: 3,
      marginTop: 6,
    },

    // Full CGV annex
    cgvAnnexSection: {
      marginTop: 8,
      paddingTop: 6,
      borderTopWidth: 1,
      borderTopColor: '#eeeeee',
    },
    cgvAnnexTitle: {
      fontSize: 10,
      fontFamily: 'Helvetica-Bold',
      color: '#1a1a1a',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 10,
    },
    cgvAnnexHeading1: {
      fontSize: 9,
      fontFamily: 'Helvetica-Bold',
      color: '#222222',
      marginTop: 8,
      marginBottom: 4,
    },
    cgvAnnexHeading2: {
      fontSize: 8.5,
      fontFamily: 'Helvetica-Bold',
      color: '#333333',
      marginTop: 7,
      marginBottom: 3,
    },
    cgvAnnexHeading3: {
      fontSize: 8,
      fontFamily: 'Helvetica-Bold',
      color: '#444444',
      marginTop: 6,
      marginBottom: 3,
    },
    cgvAnnexParagraph: {
      fontSize: 8,
      color: '#444444',
      lineHeight: 1.5,
      marginBottom: 4,
    },
    cgvAnnexList: {
      marginBottom: 5,
    },
    cgvAnnexListItem: {
      flexDirection: 'row',
      marginBottom: 2,
    },
    cgvAnnexListMarker: {
      width: 14,
      fontSize: 8,
      color: '#444444',
      fontFamily: 'Helvetica-Bold',
    },
    cgvAnnexListText: {
      flex: 1,
      fontSize: 8,
      color: '#444444',
      lineHeight: 1.45,
    },

    // Footer
    footer: {
      position: 'absolute',
      bottom: 15,
      left: 40,
      right: 40,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: '#eeeeee',
    },
    footerContent: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    footerLeft: {
      fontSize: 7,
      color: '#999999',
    },
    footerCenter: {
      fontSize: 7,
      color: '#888888',
    },
    footerRight: {
      fontSize: 7,
      color: '#999999',
    },

    // Page number
    pageNumber: {
      position: 'absolute',
      bottom: 25,
      right: 40,
      fontSize: 7,
      color: '#999999',
    },
  })
}

// Default styles (backwards compatibility)
export const styles = createContractStyles('#0066FF')
