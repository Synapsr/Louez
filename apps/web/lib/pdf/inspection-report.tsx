import type { ComponentType, PropsWithChildren } from 'react'
import {
  Document as BaseDocument,
  Page as BasePage,
  Text as BaseText,
  View as BaseView,
  Image as BaseImage,
} from '@react-pdf/renderer'
import { format } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import { createInspectionStyles } from './inspection-styles'

// Cast react-pdf components to React types for TS/React 19 compatibility.
type PdfComponent = ComponentType<PropsWithChildren<Record<string, unknown>>>
const Document = BaseDocument as unknown as PdfComponent
const Page = BasePage as unknown as PdfComponent
const Text = BaseText as unknown as PdfComponent
const View = BaseView as unknown as PdfComponent
const Image = BaseImage as unknown as PdfComponent

export type SupportedLocale = 'fr' | 'en'

export interface InspectionTranslations {
  documentType: {
    departure: string
    return: string
  }
  documentNumber: string
  reservationNumber: string
  sections: {
    inspectionDetails: string
    equipment: string
    signature: string
    notes: string
  }
  parties: {
    store: string
    customer: string
  }
  period: {
    date: string
    time: string
    performedBy: string
  }
  condition: {
    excellent: string
    good: string
    fair: string
    damaged: string
    label: string
  }
  table: {
    equipment: string
    condition: string
    photos: string
    notes: string
  }
  signature: {
    customerSignature: string
    signedAt: string
    ipAddress: string
    notSigned: string
  }
  footer: {
    poweredBy: string
    generatedOn: string
    page: string
    of: string
  }
  summary: {
    totalItems: string
    withIssues: string
    photos: string
    damageDetected: string
    noDamage: string
  }
}

interface Store {
  name: string
  logoUrl?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  primaryColor?: string
}

interface Customer {
  firstName: string
  lastName: string
  email: string
  phone?: string | null
}

interface InspectionPhoto {
  url: string
  caption?: string | null
}

interface InspectionItem {
  productName: string
  condition: 'excellent' | 'good' | 'fair' | 'damaged'
  notes?: string | null
  photos: InspectionPhoto[]
}

interface Inspection {
  id: string
  type: 'departure' | 'return'
  status: 'draft' | 'completed' | 'signed'
  reservationNumber: string
  customerName: string
  hasDamage: boolean
  notes?: string | null
  performedByName?: string | null
  createdAt: Date
  signedAt?: Date | null
  signatureIp?: string | null
  customerSignature?: string | null
  items: InspectionItem[]
}

interface InspectionReportProps {
  inspection: Inspection
  store: Store
  document: {
    number: string
    generatedAt: Date
  }
  locale: SupportedLocale
  translations: InspectionTranslations
}

function getDateLocale(locale: SupportedLocale) {
  return locale === 'fr' ? fr : enUS
}

function formatFullDate(date: Date, locale: SupportedLocale): string {
  const dateLocale = getDateLocale(locale)
  return format(date, 'EEEE d MMMM yyyy', { locale: dateLocale })
}

function formatTime(date: Date, locale: SupportedLocale): string {
  const dateLocale = getDateLocale(locale)
  return format(date, 'HH:mm', { locale: dateLocale })
}

function formatDateTimePrecise(date: Date, locale: SupportedLocale): string {
  const dateLocale = getDateLocale(locale)
  const atWord = locale === 'fr' ? 'à' : 'at'
  return format(date, `d MMMM yyyy '${atWord}' HH:mm:ss`, { locale: dateLocale })
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export function InspectionReportDocument({
  inspection,
  store,
  document: doc,
  locale,
  translations: t,
}: InspectionReportProps) {
  const primaryColor = store.primaryColor || '#0066FF'
  const styles = createInspectionStyles(primaryColor)

  // Calculate summary stats
  const totalItems = inspection.items.length
  const itemsWithIssues = inspection.items.filter(
    (item) => item.condition === 'fair' || item.condition === 'damaged' || item.notes
  ).length
  const totalPhotos = inspection.items.reduce((sum, item) => sum + item.photos.length, 0)

  const conditionColors: Record<string, string> = {
    excellent: '#059669',
    good: '#2563eb',
    fair: '#d97706',
    damaged: '#dc2626',
  }

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        {/* Colored accent bar */}
        <View style={styles.headerBar} fixed />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            {store.logoUrl ? (
              <Image src={store.logoUrl} style={styles.logo} />
            ) : (
              <Text style={styles.storeName}>{store.name}</Text>
            )}
          </View>
          <View style={styles.headerRight}>
            <View style={styles.documentTypeContainer}>
              <Text style={styles.documentType}>
                {inspection.type === 'departure' ? t.documentType.departure : t.documentType.return}
              </Text>
            </View>
            <View style={styles.documentInfo}>
              <Text style={styles.documentNumber}>
                {t.documentNumber.replace('{number}', doc.number)}
              </Text>
              <Text style={styles.documentDate}>
                {t.reservationNumber.replace('{number}', inspection.reservationNumber)}
              </Text>
            </View>
          </View>
        </View>

        {/* Inspection Details */}
        <View style={styles.detailsSection} wrap={false}>
          <Text style={styles.sectionTitle}>{t.sections.inspectionDetails}</Text>
          <View style={styles.detailsGrid}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t.period.date}</Text>
              <Text style={styles.detailValue}>
                {capitalize(formatFullDate(inspection.createdAt, locale))}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t.period.time}</Text>
              <Text style={styles.detailValue}>{formatTime(inspection.createdAt, locale)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t.parties.customer}</Text>
              <Text style={styles.detailValue}>{inspection.customerName}</Text>
            </View>
            {inspection.performedByName && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{t.period.performedBy}</Text>
                <Text style={styles.detailValue}>{inspection.performedByName}</Text>
              </View>
            )}
          </View>

          {/* Summary badges */}
          <View style={styles.summaryBadges}>
            <View style={styles.summaryBadge}>
              <Text style={styles.summaryValue}>{totalItems}</Text>
              <Text style={styles.summaryLabel}>{t.summary.totalItems}</Text>
            </View>
            <View style={styles.summaryBadge}>
              <Text style={styles.summaryValue}>{totalPhotos}</Text>
              <Text style={styles.summaryLabel}>{t.summary.photos}</Text>
            </View>
            <View
              style={
                inspection.hasDamage
                  ? [styles.summaryBadge, styles.summaryBadgeDanger]
                  : styles.summaryBadge
              }
            >
              <Text
                style={
                  inspection.hasDamage
                    ? [styles.summaryValue, styles.summaryValueDanger]
                    : styles.summaryValue
                }
              >
                {inspection.hasDamage ? '!' : '✓'}
              </Text>
              <Text
                style={
                  inspection.hasDamage
                    ? [styles.summaryLabel, styles.summaryLabelDanger]
                    : styles.summaryLabel
                }
              >
                {inspection.hasDamage ? t.summary.damageDetected : t.summary.noDamage}
              </Text>
            </View>
          </View>
        </View>

        {/* Equipment List */}
        <View style={styles.equipmentSection}>
          <Text style={styles.sectionTitle}>{t.sections.equipment}</Text>

          {inspection.items.map((item, index) => (
            <View key={index} style={styles.itemCard} wrap={false}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemName}>{item.productName}</Text>
                <View
                  style={[
                    styles.conditionBadge,
                    { backgroundColor: conditionColors[item.condition] },
                  ]}
                >
                  <Text style={styles.conditionText}>{t.condition[item.condition]}</Text>
                </View>
              </View>

              {item.notes && (
                <View style={styles.itemNotes}>
                  <Text style={styles.notesLabel}>{t.table.notes}:</Text>
                  <Text style={styles.notesText}>{item.notes}</Text>
                </View>
              )}

              {item.photos.length > 0 && (
                <View style={styles.photosGrid}>
                  {item.photos.slice(0, 4).map((photo, photoIndex) => (
                    <View key={photoIndex} style={styles.photoContainer}>
                      <Image src={photo.url} style={styles.photo} />
                      {photo.caption && <Text style={styles.photoCaption}>{photo.caption}</Text>}
                    </View>
                  ))}
                  {item.photos.length > 4 && (
                    <View style={styles.morePhotos}>
                      <Text style={styles.morePhotosText}>+{item.photos.length - 4}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          ))}
        </View>

        {/* Global Notes */}
        {inspection.notes && (
          <View style={styles.globalNotes} wrap={false}>
            <Text style={styles.sectionTitle}>{t.sections.notes}</Text>
            <Text style={styles.globalNotesText}>{inspection.notes}</Text>
          </View>
        )}

        {/* Signature */}
        <View style={styles.signatureSection} wrap={false}>
          <Text style={styles.sectionTitle}>{t.sections.signature}</Text>

          {inspection.customerSignature ? (
            <View style={styles.signatureContent}>
              <View style={styles.signatureBox}>
                <Text style={styles.signatureLabel}>{t.signature.customerSignature}</Text>
                <Image src={inspection.customerSignature} style={styles.signatureImage} />
              </View>
              <View style={styles.signatureDetails}>
                {inspection.signedAt && (
                  <Text style={styles.signatureDetailText}>
                    {t.signature.signedAt}: {formatDateTimePrecise(inspection.signedAt, locale)}
                  </Text>
                )}
                {inspection.signatureIp && (
                  <Text style={styles.signatureDetailText}>
                    {t.signature.ipAddress}: {inspection.signatureIp}
                  </Text>
                )}
              </View>
            </View>
          ) : (
            <View style={styles.noSignature}>
              <Text style={styles.noSignatureText}>{t.signature.notSigned}</Text>
            </View>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerLeft}>
            {t.footer.generatedOn} {formatDateTimePrecise(doc.generatedAt, locale)}
          </Text>
          <Text
            style={styles.footerRight}
            render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
              `${t.footer.page} ${pageNumber} ${t.footer.of} ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  )
}

// Default translations
export const defaultTranslationsFr: InspectionTranslations = {
  documentType: {
    departure: 'État des lieux - Départ',
    return: 'État des lieux - Retour',
  },
  documentNumber: 'N° {number}',
  reservationNumber: 'Réservation #{number}',
  sections: {
    inspectionDetails: "Détails de l'inspection",
    equipment: 'Équipements inspectés',
    signature: 'Signature',
    notes: 'Notes générales',
  },
  parties: {
    store: 'Loueur',
    customer: 'Client',
  },
  period: {
    date: 'Date',
    time: 'Heure',
    performedBy: 'Effectué par',
  },
  condition: {
    excellent: 'Excellent',
    good: 'Bon état',
    fair: 'Usure',
    damaged: 'Endommagé',
    label: 'État',
  },
  table: {
    equipment: 'Équipement',
    condition: 'État',
    photos: 'Photos',
    notes: 'Remarques',
  },
  signature: {
    customerSignature: 'Signature du client',
    signedAt: 'Signé le',
    ipAddress: 'Adresse IP',
    notSigned: 'Non signé',
  },
  footer: {
    poweredBy: 'Généré par Louez.io',
    generatedOn: 'Généré le',
    page: 'Page',
    of: 'sur',
  },
  summary: {
    totalItems: 'équipements',
    withIssues: 'avec remarques',
    photos: 'photos',
    damageDetected: 'Dommage détecté',
    noDamage: 'Aucun dommage',
  },
}

export const defaultTranslationsEn: InspectionTranslations = {
  documentType: {
    departure: 'Inspection Report - Departure',
    return: 'Inspection Report - Return',
  },
  documentNumber: 'No. {number}',
  reservationNumber: 'Reservation #{number}',
  sections: {
    inspectionDetails: 'Inspection Details',
    equipment: 'Inspected Equipment',
    signature: 'Signature',
    notes: 'General Notes',
  },
  parties: {
    store: 'Rental Company',
    customer: 'Customer',
  },
  period: {
    date: 'Date',
    time: 'Time',
    performedBy: 'Performed by',
  },
  condition: {
    excellent: 'Excellent',
    good: 'Good',
    fair: 'Fair',
    damaged: 'Damaged',
    label: 'Condition',
  },
  table: {
    equipment: 'Equipment',
    condition: 'Condition',
    photos: 'Photos',
    notes: 'Notes',
  },
  signature: {
    customerSignature: 'Customer Signature',
    signedAt: 'Signed at',
    ipAddress: 'IP Address',
    notSigned: 'Not signed',
  },
  footer: {
    poweredBy: 'Powered by Louez.io',
    generatedOn: 'Generated on',
    page: 'Page',
    of: 'of',
  },
  summary: {
    totalItems: 'items',
    withIssues: 'with issues',
    photos: 'photos',
    damageDetected: 'Damage detected',
    noDamage: 'No damage',
  },
}
