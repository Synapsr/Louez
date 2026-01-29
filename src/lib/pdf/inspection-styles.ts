import { StyleSheet } from '@react-pdf/renderer'
import { getLighterColor, getContrastColor } from './styles'

export function createInspectionStyles(primaryColor: string = '#0066FF') {
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
      fontSize: 10,
      fontFamily: 'Helvetica-Bold',
      color: contrastColor,
      textTransform: 'uppercase',
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

    // Details Section
    detailsSection: {
      marginBottom: 20,
      padding: 15,
      backgroundColor: lightBg,
      borderRadius: 6,
    },
    sectionTitle: {
      fontSize: 11,
      fontFamily: 'Helvetica-Bold',
      color: primaryColor,
      marginBottom: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    detailsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 15,
    },
    detailRow: {
      width: '45%',
      marginBottom: 8,
    },
    detailLabel: {
      fontSize: 8,
      color: '#666666',
      marginBottom: 2,
      textTransform: 'uppercase',
    },
    detailValue: {
      fontSize: 10,
      fontFamily: 'Helvetica-Bold',
      color: '#1a1a1a',
    },

    // Summary badges
    summaryBadges: {
      flexDirection: 'row',
      marginTop: 15,
      gap: 10,
    },
    summaryBadge: {
      flex: 1,
      backgroundColor: '#ffffff',
      borderRadius: 4,
      padding: 10,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: '#e5e5e5',
    },
    summaryBadgeDanger: {
      backgroundColor: '#fef2f2',
      borderColor: '#fecaca',
    },
    summaryValue: {
      fontSize: 16,
      fontFamily: 'Helvetica-Bold',
      color: primaryColor,
    },
    summaryValueDanger: {
      color: '#dc2626',
    },
    summaryLabel: {
      fontSize: 8,
      color: '#666666',
      marginTop: 2,
      textTransform: 'uppercase',
    },
    summaryLabelDanger: {
      color: '#dc2626',
    },

    // Equipment Section
    equipmentSection: {
      marginBottom: 20,
    },
    itemCard: {
      marginBottom: 12,
      padding: 12,
      backgroundColor: '#f9fafb',
      borderRadius: 6,
      borderWidth: 1,
      borderColor: '#e5e5e5',
    },
    itemHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    itemName: {
      fontSize: 11,
      fontFamily: 'Helvetica-Bold',
      color: '#1a1a1a',
      flex: 1,
    },
    conditionBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 4,
    },
    conditionText: {
      fontSize: 8,
      fontFamily: 'Helvetica-Bold',
      color: '#ffffff',
      textTransform: 'uppercase',
    },
    itemNotes: {
      marginBottom: 8,
      padding: 8,
      backgroundColor: '#ffffff',
      borderRadius: 4,
    },
    notesLabel: {
      fontSize: 8,
      color: '#666666',
      marginBottom: 2,
    },
    notesText: {
      fontSize: 9,
      color: '#1a1a1a',
    },

    // Photos
    photosGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    photoContainer: {
      width: 80,
    },
    photo: {
      width: 80,
      height: 60,
      objectFit: 'cover',
      borderRadius: 4,
    },
    photoCaption: {
      fontSize: 7,
      color: '#666666',
      marginTop: 2,
    },
    morePhotos: {
      width: 80,
      height: 60,
      backgroundColor: '#e5e5e5',
      borderRadius: 4,
      justifyContent: 'center',
      alignItems: 'center',
    },
    morePhotosText: {
      fontSize: 12,
      fontFamily: 'Helvetica-Bold',
      color: '#666666',
    },

    // Global Notes
    globalNotes: {
      marginBottom: 20,
      padding: 15,
      backgroundColor: '#f9fafb',
      borderRadius: 6,
      borderWidth: 1,
      borderColor: '#e5e5e5',
    },
    globalNotesText: {
      fontSize: 10,
      color: '#1a1a1a',
      lineHeight: 1.6,
    },

    // Signature Section
    signatureSection: {
      marginBottom: 20,
      padding: 15,
      backgroundColor: lightBg,
      borderRadius: 6,
    },
    signatureContent: {
      flexDirection: 'row',
      gap: 20,
    },
    signatureBox: {
      flex: 1,
      backgroundColor: '#ffffff',
      borderRadius: 4,
      padding: 10,
      borderWidth: 1,
      borderColor: '#e5e5e5',
    },
    signatureLabel: {
      fontSize: 8,
      color: '#666666',
      marginBottom: 8,
      textTransform: 'uppercase',
    },
    signatureImage: {
      maxWidth: 200,
      maxHeight: 60,
      objectFit: 'contain',
    },
    signatureDetails: {
      flex: 1,
      justifyContent: 'center',
    },
    signatureDetailText: {
      fontSize: 8,
      color: '#666666',
      marginBottom: 4,
    },
    noSignature: {
      padding: 20,
      backgroundColor: '#f9fafb',
      borderRadius: 4,
      alignItems: 'center',
    },
    noSignatureText: {
      fontSize: 10,
      color: '#666666',
      fontStyle: 'italic',
    },

    // Footer
    footer: {
      position: 'absolute',
      bottom: 30,
      left: 40,
      right: 40,
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: '#e5e5e5',
      paddingTop: 10,
    },
    footerLeft: {
      fontSize: 7,
      color: '#999999',
    },
    footerRight: {
      fontSize: 7,
      color: '#999999',
    },
  })
}
