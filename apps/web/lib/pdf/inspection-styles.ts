import { StyleSheet } from "@react-pdf/renderer";
import { pdfPalette } from "./styles";

/** Text colour of each condition pill; the pill itself stays on the neutral block. */
export const CONDITION_COLORS: Record<"excellent" | "good" | "fair" | "damaged", string> = {
  excellent: pdfPalette.success,
  good: pdfPalette.ink,
  fair: pdfPalette.warning,
  damaged: pdfPalette.danger,
};

export function createInspectionStyles(_primaryColor: string = "#0066FF") {
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

    // Details Section
    detailsSection: {
      marginBottom: 20,
      padding: 14,
      backgroundColor: c.block,
      borderRadius: 8,
    },
    sectionTitle: {
      fontSize: 7.5,
      fontFamily: "Helvetica-Bold",
      color: c.muted,
      marginBottom: 10,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    detailsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
    },
    detailRow: {
      width: "45%",
      marginBottom: 6,
    },
    detailLabel: {
      fontSize: 7,
      color: c.muted,
      marginBottom: 2,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    detailValue: {
      fontSize: 10,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
    },

    // Summary badges
    summaryBadges: {
      flexDirection: "row",
      marginTop: 12,
      gap: 10,
    },
    summaryBadge: {
      flex: 1,
      backgroundColor: "#ffffff",
      borderRadius: 8,
      padding: 10,
      alignItems: "center",
    },
    summaryBadgeDanger: {},
    summaryValue: {
      fontSize: 16,
      lineHeight: 1.2,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
    },
    summaryValueDanger: {
      color: c.danger,
    },
    summaryLabel: {
      fontSize: 7,
      color: c.muted,
      marginTop: 2,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    summaryLabelDanger: {
      color: c.danger,
    },

    // Equipment Section
    equipmentSection: {
      marginBottom: 20,
    },
    itemCard: {
      marginBottom: 10,
      padding: 12,
      backgroundColor: c.block,
      borderRadius: 8,
    },
    itemHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 6,
    },
    itemName: {
      fontSize: 10.5,
      fontFamily: "Helvetica-Bold",
      color: c.ink,
      flex: 1,
    },
    conditionBadge: {
      paddingHorizontal: 8,
      paddingTop: 4,
      paddingBottom: 4,
      borderRadius: 999,
      backgroundColor: "#ffffff",
      justifyContent: "center",
    },
    conditionText: {
      fontSize: 7,
      lineHeight: 1,
      fontFamily: "Helvetica-Bold",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    itemNotes: {
      marginBottom: 8,
    },
    notesLabel: {
      fontSize: 7,
      color: c.muted,
      marginBottom: 2,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    notesText: {
      fontSize: 9,
      color: c.ink,
    },

    // Photos
    photosGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    photoContainer: {
      width: 80,
    },
    photo: {
      width: 80,
      height: 60,
      objectFit: "cover",
      borderRadius: 4,
    },
    photoCaption: {
      fontSize: 7,
      color: c.muted,
      marginTop: 2,
    },
    morePhotos: {
      width: 80,
      height: 60,
      backgroundColor: c.border,
      borderRadius: 4,
      justifyContent: "center",
      alignItems: "center",
    },
    morePhotosText: {
      fontSize: 12,
      fontFamily: "Helvetica-Bold",
      color: c.muted,
    },

    // Global Notes
    globalNotes: {
      marginBottom: 20,
      padding: 14,
      backgroundColor: c.block,
      borderRadius: 8,
    },
    globalNotesText: {
      fontSize: 9.5,
      color: c.ink,
      lineHeight: 1.5,
    },

    // Signature Section
    signatureSection: {
      marginBottom: 20,
    },
    signatureContent: {
      flexDirection: "row",
      gap: 12,
    },
    signatureBox: {
      flex: 1,
      backgroundColor: c.block,
      borderRadius: 8,
      padding: 12,
    },
    signatureLabel: {
      fontSize: 7,
      color: c.muted,
      marginBottom: 8,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    signatureImage: {
      maxWidth: 200,
      maxHeight: 60,
      objectFit: "contain",
    },
    signatureDetails: {
      flex: 1,
      justifyContent: "center",
    },
    signatureDetailText: {
      fontSize: 8,
      color: c.muted,
      marginBottom: 4,
    },
    noSignature: {
      padding: 16,
      backgroundColor: c.block,
      borderRadius: 8,
      alignItems: "center",
    },
    noSignatureText: {
      fontSize: 9,
      color: c.muted,
    },

    // Footer
    footer: {
      position: "absolute",
      bottom: 20,
      left: 44,
      right: 44,
      flexDirection: "row",
      justifyContent: "space-between",
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingTop: 10,
    },
    footerLeft: {
      fontSize: 7,
      color: c.faint,
    },
    footerRight: {
      fontSize: 7,
      color: c.faint,
    },
  });
}
