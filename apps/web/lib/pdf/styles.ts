import { StyleSheet } from "@react-pdf/renderer";
import { emailTheme } from "@louez/email/templates";

// Helper to convert hex to rgba for lighter tints
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Get a lighter version of a color for backgrounds (very subtle)
export function getLighterColor(hex: string, intensity: number = 0.08): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lightR = Math.round(r * intensity + 255 * (1 - intensity));
  const lightG = Math.round(g * intensity + 255 * (1 - intensity));
  const lightB = Math.round(b * intensity + 255 * (1 - intensity));
  return `rgb(${lightR}, ${lightG}, ${lightB})`;
}

// Get contrasting text color (white or dark)
// Uses threshold of 0.55 to favor white text on medium-dark colors
export function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#1a1a1a" : "#ffffff";
}

/** Green of the "covered by breakage/theft coverage" note under an insured line. */
export const INSURED_COLOR = "#15803d";

/**
 * The PDFs share the emails' palette: neutral zinc greys, grey blocks with no
 * border, the store colour kept out of the shell for now. Only status text
 * (paid, pending, damaged) carries a semantic colour.
 */
export const pdfPalette = {
  ink: emailTheme.colors.ink,
  body: emailTheme.colors.body,
  muted: emailTheme.colors.muted,
  faint: emailTheme.colors.faint,
  border: emailTheme.colors.border,
  hairline: "#f0f0f2",
  block: emailTheme.colors.bgSubtle,
  success: INSURED_COLOR,
  warning: "#b45309",
  danger: "#dc2626",
} as const;

// Create dynamic styles based on primary color
export function createContractStyles(_primaryColor: string = "#0066FF") {
  const c = pdfPalette;

  return StyleSheet.create({
    // Page
    page: {
      paddingTop: 44,
      paddingBottom: 64,
      paddingHorizontal: 44,
      fontSize: 9,
      fontFamily: "Helvetica",
      color: c.body,
      lineHeight: 1.45,
    },

    // Header
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 24,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    logoContainer: {
      flexDirection: "column",
      justifyContent: "center",
      maxWidth: "50%",
      minHeight: 40,
    },
    logo: {
      maxWidth: 160,
      maxHeight: 40,
      objectFit: "contain",
    },
    storeName: {
      fontSize: 16,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
    },
    headerRight: {
      flexDirection: "column",
      alignItems: "flex-end",
    },
    documentTypeContainer: {
      marginBottom: 4,
    },
    documentType: {
      fontSize: 14,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
      textAlign: "right",
    },
    documentInfo: {
      textAlign: "right",
    },
    documentNumber: {
      fontSize: 9,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
      marginBottom: 1,
      textAlign: "right",
    },
    documentDate: {
      fontSize: 8.5,
      color: c.muted,
      textAlign: "right",
    },

    // Parties section
    partiesContainer: {
      flexDirection: "row",
      marginBottom: 22,
      gap: 12,
    },
    partyCard: {
      flex: 1,
      backgroundColor: c.block,
      borderRadius: 8,
      padding: 14,
    },
    partyLabel: {
      fontSize: 7,
      fontFamily: "Helvetica-Bold",
      color: c.muted,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 6,
    },
    partyName: {
      fontSize: 10.5,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
      marginBottom: 3,
    },
    partyInfo: {
      fontSize: 8.5,
      color: c.body,
      marginBottom: 1,
    },
    partyLegal: {
      fontSize: 7.5,
      color: c.faint,
      marginTop: 4,
    },

    // Period section
    periodSection: {
      marginBottom: 20,
    },
    sectionTitle: {
      fontSize: 7.5,
      fontFamily: "Helvetica-Bold",
      color: c.muted,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 8,
    },
    periodContainer: {
      flexDirection: "row",
      gap: 12,
    },
    periodCard: {
      flex: 1,
      backgroundColor: c.block,
      borderRadius: 8,
      padding: 12,
      flexDirection: "row",
      alignItems: "center",
    },
    periodContent: {
      flex: 1,
    },
    periodLabel: {
      fontSize: 7,
      fontFamily: "Helvetica-Bold",
      color: c.muted,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 2,
    },
    periodDate: {
      fontSize: 10,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
    },
    periodTime: {
      fontSize: 8.5,
      color: c.body,
    },
    periodDeliveryInfo: {
      fontSize: 8,
      color: c.muted,
      marginTop: 3,
    },

    // Table section
    tableSection: {
      marginBottom: 18,
    },
    table: {},
    tableHeader: {
      flexDirection: "row",
      paddingVertical: 6,
      paddingHorizontal: 2,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    tableHeaderCell: {
      fontSize: 7,
      fontFamily: "Helvetica-Bold",
      color: c.muted,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    tableRow: {
      flexDirection: "row",
      paddingVertical: 8,
      paddingHorizontal: 2,
      borderBottomWidth: 1,
      borderBottomColor: c.hairline,
    },
    tableRowAlt: {},
    tableRowLast: {
      borderBottomWidth: 0,
    },
    tableCell: {
      fontSize: 9,
      color: c.ink,
    },
    tableCellName: {
      flex: 4,
    },
    tableCellQty: {
      flex: 1,
      textAlign: "center",
    },
    tableCellPrice: {
      flex: 1.5,
      textAlign: "right",
    },
    tableCellTotal: {
      flex: 1.5,
      textAlign: "right",
    },
    unitIdentifiers: {
      fontSize: 7.5,
      color: c.muted,
      marginTop: 2,
    },
    insuredRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      marginTop: 3,
    },
    insuredText: {
      fontSize: 7.5,
      lineHeight: 1,
      color: INSURED_COLOR,
    },

    // Totals
    totalsContainer: {
      marginTop: 10,
      alignItems: "flex-end",
    },
    totalsBox: {
      width: 230,
    },
    totalRow: {
      flexDirection: "row",
      paddingVertical: 4,
      paddingHorizontal: 2,
    },
    totalRowLast: {},
    totalLabel: {
      flex: 1,
      fontSize: 9,
      color: c.body,
    },
    totalValue: {
      fontSize: 9,
      color: c.ink,
      textAlign: "right",
    },
    totalRowMain: {
      marginTop: 4,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    totalLabelMain: {
      flex: 1,
      fontSize: 10,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
    },
    totalValueMain: {
      fontSize: 11,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
      textAlign: "right",
    },
    depositRow: {},
    depositLabel: {
      flex: 1,
      fontSize: 9,
      color: c.muted,
    },
    depositValue: {
      fontSize: 9,
      color: c.muted,
      textAlign: "right",
    },

    // Payments section
    paymentsSection: {
      marginBottom: 18,
    },
    paymentsList: {},
    paymentRow: {
      flexDirection: "row",
      paddingVertical: 7,
      paddingHorizontal: 2,
      borderBottomWidth: 1,
      borderBottomColor: c.hairline,
      alignItems: "center",
    },
    paymentRowLast: {
      borderBottomWidth: 0,
    },
    paymentStatus: {
      fontSize: 8,
      fontFamily: "Helvetica-Bold",
      marginRight: 12,
      width: 60,
      textAlign: "right",
    },
    paymentStatusCompleted: {
      color: c.success,
    },
    paymentStatusPending: {
      color: c.warning,
    },
    paymentDetails: {
      flex: 1,
    },
    paymentType: {
      fontSize: 9,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
    },
    paymentMethod: {
      fontSize: 8,
      color: c.muted,
    },
    paymentDate: {
      fontSize: 8,
      color: c.muted,
      marginRight: 12,
    },
    paymentAmount: {
      fontSize: 9,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
      width: 70,
      textAlign: "right",
    },
    paymentAmountPending: {
      color: c.muted,
    },
    noPayments: {
      padding: 12,
      fontSize: 8,
      color: c.faint,
      textAlign: "center",
    },
    paymentSummary: {
      flexDirection: "row",
      justifyContent: "flex-end",
      paddingTop: 8,
      marginTop: 8,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    paymentSummaryItem: {
      marginLeft: 20,
    },
    paymentSummaryLabel: {
      fontSize: 8,
      color: c.muted,
    },
    paymentSummaryValue: {
      fontSize: 10,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
    },
    paymentSummaryValueSuccess: {
      color: c.success,
    },
    paymentSummaryValueWarning: {
      color: c.warning,
    },

    // Conditions section
    conditionsSection: {
      marginBottom: 18,
    },
    conditionsList: {
      backgroundColor: c.block,
      borderRadius: 8,
      padding: 12,
    },
    conditionItem: {
      flexDirection: "row",
      marginBottom: 4,
    },
    conditionBullet: {
      width: 3,
      height: 3,
      borderRadius: 1.5,
      backgroundColor: c.faint,
      marginRight: 8,
      marginTop: 4.5,
    },
    conditionText: {
      flex: 1,
      fontSize: 8,
      color: c.body,
      lineHeight: 1.4,
    },

    // Signatures section
    signaturesSection: {
      marginTop: 12,
    },
    signaturesContainer: {
      flexDirection: "row",
      gap: 12,
    },
    signatureBox: {
      flex: 1,
      backgroundColor: c.block,
      borderRadius: 8,
      padding: 12,
    },
    signatureHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    signatureTitle: {
      fontSize: 7,
      fontFamily: "Helvetica-Bold",
      color: c.muted,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    signatureStatusText: {
      fontSize: 8,
      fontFamily: "Helvetica-Bold",
      color: c.success,
    },
    signatureStatusPendingText: {
      fontSize: 8,
      fontFamily: "Helvetica-Bold",
      color: c.warning,
    },
    signatureContent: {
      marginTop: 4,
    },
    signatureText: {
      fontSize: 7.5,
      color: c.body,
      marginBottom: 8,
      lineHeight: 1.4,
    },
    signatureDateRow: {
      flexDirection: "row",
      marginBottom: 2,
    },
    signatureDateLabel: {
      fontSize: 7.5,
      color: c.muted,
      width: 45,
    },
    signatureDate: {
      fontSize: 7.5,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
      flex: 1,
    },
    signatureIp: {
      fontSize: 7,
      color: c.faint,
      marginTop: 4,
    },

    // Legal mentions
    legalSection: {
      marginTop: 16,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    legalText: {
      fontSize: 7,
      color: c.faint,
      lineHeight: 1.4,
      marginBottom: 2,
    },
    legalTitle: {
      fontSize: 7,
      fontFamily: "Helvetica-Bold",
      color: c.muted,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 4,
      marginTop: 4,
    },

    // Full CGV annex
    cgvAnnexSection: {
      marginTop: 8,
      paddingTop: 6,
    },
    cgvAnnexTitle: {
      fontSize: 12,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
      marginBottom: 12,
    },
    cgvAnnexHeading1: {
      fontSize: 9.5,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
      marginTop: 10,
      marginBottom: 4,
    },
    cgvAnnexHeading2: {
      fontSize: 9,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
      marginTop: 8,
      marginBottom: 3,
    },
    cgvAnnexHeading3: {
      fontSize: 8.5,
      fontFamily: "Helvetica-Bold",
      color: c.body,
      marginTop: 6,
      marginBottom: 3,
    },
    cgvAnnexParagraph: {
      fontSize: 8,
      color: c.body,
      lineHeight: 1.5,
      marginBottom: 4,
    },
    cgvAnnexList: {
      marginBottom: 5,
    },
    cgvAnnexListItem: {
      flexDirection: "row",
      marginBottom: 2,
    },
    cgvAnnexListMarker: {
      width: 14,
      fontSize: 8,
      color: c.muted,
    },
    cgvAnnexListText: {
      flex: 1,
      fontSize: 8,
      color: c.body,
      lineHeight: 1.45,
    },

    // Footer
    footer: {
      position: "absolute",
      bottom: 20,
      left: 44,
      right: 44,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    footerContent: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    footerLeft: {
      fontSize: 7,
      color: c.faint,
    },
    footerCenter: {
      fontSize: 7,
      color: c.faint,
    },
    footerRight: {
      fontSize: 7,
      color: c.faint,
    },

    // Page number
    pageNumber: {
      position: "absolute",
      bottom: 8,
      right: 44,
      fontSize: 7,
      color: c.faint,
    },
  });
}

// Default styles (backwards compatibility)
export const styles = createContractStyles("#0066FF");
