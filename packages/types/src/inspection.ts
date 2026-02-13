/**
 * Inspection Types (Etat des lieux)
 *
 * Types for the inventory inspection feature that documents
 * equipment condition at pickup (departure) and return.
 */

// ============================================================================
// Enums & Literals
// ============================================================================

/**
 * Inspection type: when the inspection occurs
 */
export type InspectionType = 'departure' | 'return'

/**
 * Inspection status workflow
 */
export type InspectionStatus = 'draft' | 'completed' | 'signed'

/**
 * Quick condition assessment for items
 */
export type ConditionRating = 'excellent' | 'good' | 'fair' | 'damaged'

/**
 * Template scope determines inheritance:
 * - store: Default for all products
 * - category: For products in a category
 * - product: For a specific product (highest priority)
 */
export type InspectionTemplateScope = 'store' | 'category' | 'product'

/**
 * Field types for inspection template fields
 */
export type InspectionFieldType =
  | 'checkbox' // Simple yes/no
  | 'rating' // 1-5 scale
  | 'text' // Free text
  | 'number' // Numeric value
  | 'select' // Dropdown options

// ============================================================================
// Template Types
// ============================================================================

/**
 * A single field in an inspection template
 */
export interface InspectionTemplateField {
  id: string
  templateId: string
  name: string
  description?: string | null
  fieldType: InspectionFieldType
  options?: string[] | null // For 'select' type
  ratingMin?: number | null // For 'rating' type
  ratingMax?: number | null // For 'rating' type
  numberUnit?: string | null // For 'number' type (e.g., "hours", "km")
  isRequired: boolean
  sectionName?: string | null // Optional grouping
  displayOrder: number
  createdAt: Date
}

/**
 * An inspection template with its fields
 */
export interface InspectionTemplate {
  id: string
  storeId: string
  scope: InspectionTemplateScope
  categoryId?: string | null
  productId?: string | null
  name: string
  description?: string | null
  isActive: boolean
  displayOrder: number
  fields: InspectionTemplateField[]
  createdAt: Date
  updatedAt: Date
}

/**
 * Snapshot of a template at inspection time (for historical accuracy)
 */
export interface InspectionTemplateSnapshot {
  id: string
  name: string
  fields: Array<{
    id: string
    name: string
    fieldType: string
    options?: string[]
    ratingMin?: number
    ratingMax?: number
    numberUnit?: string
    isRequired: boolean
    sectionName?: string
  }>
}

// ============================================================================
// Inspection Types
// ============================================================================

/**
 * Product snapshot stored with inspection item
 */
export interface InspectionProductSnapshot {
  name: string
  unitIdentifier?: string
}

/**
 * Field snapshot stored with field value
 */
export interface InspectionFieldSnapshot {
  name: string
  fieldType: string
  sectionName?: string
}

/**
 * A single field value recorded during inspection
 */
export interface InspectionFieldValue {
  id: string
  inspectionItemId: string
  templateFieldId: string
  fieldSnapshot: InspectionFieldSnapshot
  // Values (only one used based on type)
  checkboxValue?: boolean | null
  ratingValue?: number | null
  textValue?: string | null
  numberValue?: number | null
  selectValue?: string | null
  hasIssue: boolean
  createdAt: Date
}

/**
 * A photo taken during inspection
 */
export interface InspectionPhoto {
  id: string
  inspectionItemId: string
  fieldValueId?: string | null
  photoKey: string
  photoUrl: string
  thumbnailKey?: string | null
  thumbnailUrl?: string | null
  caption?: string | null
  displayOrder: number
  createdAt: Date
}

/**
 * An item being inspected within a reservation
 */
export interface InspectionItem {
  id: string
  inspectionId: string
  reservationItemId: string
  productUnitId?: string | null
  productSnapshot: InspectionProductSnapshot
  overallCondition?: ConditionRating | null
  notes?: string | null
  fieldValues: InspectionFieldValue[]
  photos: InspectionPhoto[]
  createdAt: Date
}

/**
 * Main inspection record
 */
export interface Inspection {
  id: string
  storeId: string
  reservationId: string
  type: InspectionType
  status: InspectionStatus
  templateId?: string | null
  templateSnapshot?: InspectionTemplateSnapshot | null
  notes?: string | null
  performedById?: string | null
  performedAt?: Date | null
  customerSignature?: string | null
  signedAt?: Date | null
  signatureIp?: string | null
  hasDamage: boolean
  damageDescription?: string | null
  estimatedDamageCost?: number | null
  damagePaymentId?: string | null
  items: InspectionItem[]
  createdAt: Date
  updatedAt: Date
}

// ============================================================================
// Form Input Types
// ============================================================================

/**
 * Input for creating/updating a template field
 */
export interface InspectionTemplateFieldInput {
  id?: string
  name: string
  description?: string
  fieldType: InspectionFieldType
  options?: string[]
  ratingMin?: number
  ratingMax?: number
  numberUnit?: string
  isRequired?: boolean
  sectionName?: string
  displayOrder?: number
}

/**
 * Input for creating/updating a template
 */
export interface InspectionTemplateInput {
  name: string
  description?: string
  scope: InspectionTemplateScope
  categoryId?: string | null
  productId?: string | null
  isActive?: boolean
  fields: InspectionTemplateFieldInput[]
}

/**
 * Input for a field value during inspection
 */
export interface InspectionFieldValueInput {
  templateFieldId: string
  checkboxValue?: boolean
  ratingValue?: number
  textValue?: string
  numberValue?: number
  selectValue?: string
  hasIssue?: boolean
}

/**
 * Input for an item during inspection
 */
export interface InspectionItemInput {
  reservationItemId: string
  productUnitId?: string
  overallCondition: ConditionRating
  notes?: string
  fieldValues: InspectionFieldValueInput[]
}

/**
 * Input for creating an inspection
 */
export interface CreateInspectionInput {
  reservationId: string
  type: InspectionType
  templateId?: string
  notes?: string
  items: InspectionItemInput[]
}

/**
 * Input for completing an inspection
 */
export interface CompleteInspectionInput {
  notes?: string
  hasDamage: boolean
  damageDescription?: string
  estimatedDamageCost?: number
}

/**
 * Input for signing an inspection
 */
export interface SignInspectionInput {
  customerSignature: string // Base64 signature image
}

// ============================================================================
// Comparison Types
// ============================================================================

/**
 * Change detected between departure and return inspections
 */
export interface InspectionFieldChange {
  fieldName: string
  departureValue: string | number | boolean | null
  returnValue: string | number | boolean | null
  changeType: 'improved' | 'degraded' | 'unchanged' | 'new_issue'
}

/**
 * Comparison of an item between departure and return
 */
export interface InspectionItemComparison {
  itemId: string
  productName: string
  unitIdentifier?: string
  departure: {
    overallCondition: ConditionRating | null
    fieldValues: InspectionFieldValue[]
    photos: InspectionPhoto[]
  } | null
  return: {
    overallCondition: ConditionRating | null
    fieldValues: InspectionFieldValue[]
    photos: InspectionPhoto[]
  } | null
  changes: InspectionFieldChange[]
  hasNewDamage: boolean
}

/**
 * Full comparison between departure and return inspections
 */
export interface InspectionComparison {
  reservationId: string
  departureInspection: Inspection | null
  returnInspection: Inspection | null
  items: InspectionItemComparison[]
  totalChanges: number
  hasNewDamage: boolean
}

// ============================================================================
// UI Types
// ============================================================================

/**
 * Inspection status for display in UI
 */
export interface InspectionStatusInfo {
  type: InspectionType
  status: InspectionStatus | 'not_started'
  performedAt?: Date | null
  signedAt?: Date | null
  hasDamage: boolean
  photoCount: number
  itemCount: number
}

/**
 * Summary for inspection cards
 */
export interface InspectionSummary {
  id: string
  type: InspectionType
  status: InspectionStatus
  performedAt: Date | null
  signedAt: Date | null
  hasDamage: boolean
  itemsInspected: number
  photosCount: number
  damageDescription?: string | null
  estimatedDamageCost?: number | null
}
