import { z } from 'zod'

// ============================================================================
// Enums
// ============================================================================

export const inspectionTypeSchema = z.enum(['departure', 'return'])
export const inspectionStatusSchema = z.enum(['draft', 'completed', 'signed'])
export const conditionRatingSchema = z.enum(['excellent', 'good', 'fair', 'damaged'])
export const inspectionTemplateScopeSchema = z.enum(['store', 'category', 'product'])
export const inspectionFieldTypeSchema = z.enum([
  'checkbox',
  'rating',
  'text',
  'number',
  'select',
])
export const inspectionModeSchema = z.enum(['optional', 'recommended', 'required'])

// ============================================================================
// Settings
// ============================================================================

/**
 * Schema for inspection settings in store configuration
 */
export const inspectionSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: inspectionModeSchema,
  requireCustomerSignature: z.boolean(),
  autoGeneratePdf: z.boolean(),
  maxPhotosPerItem: z.number().int().min(1).max(50),
})

export type InspectionSettingsInput = z.infer<typeof inspectionSettingsSchema>

// ============================================================================
// Template Fields
// ============================================================================

/**
 * Schema for a template field
 */
export const inspectionTemplateFieldSchema = z.object({
  id: z.string().length(21).optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional().nullable(),
  fieldType: inspectionFieldTypeSchema,
  options: z.array(z.string().max(100)).max(20).optional().nullable(),
  ratingMin: z.number().int().min(0).max(10).optional().nullable(),
  ratingMax: z.number().int().min(1).max(10).optional().nullable(),
  numberUnit: z.string().max(50).optional().nullable(),
  isRequired: z.boolean().default(false),
  sectionName: z.string().max(100).optional().nullable(),
  displayOrder: z.number().int().min(0).default(0),
})

export type InspectionTemplateFieldInput = z.infer<typeof inspectionTemplateFieldSchema>

// ============================================================================
// Templates
// ============================================================================

/**
 * Schema for creating/updating an inspection template
 */
export const inspectionTemplateSchema = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().max(2000).optional().nullable(),
    scope: inspectionTemplateScopeSchema,
    categoryId: z.string().length(21).optional().nullable(),
    productId: z.string().length(21).optional().nullable(),
    isActive: z.boolean().default(true),
    fields: z.array(inspectionTemplateFieldSchema).min(1).max(50),
  })
  .refine(
    (data) => {
      // Category scope requires categoryId
      if (data.scope === 'category' && !data.categoryId) {
        return false
      }
      // Product scope requires productId
      if (data.scope === 'product' && !data.productId) {
        return false
      }
      return true
    },
    {
      message:
        'Category ID required for category scope, Product ID required for product scope',
    }
  )

export type InspectionTemplateInput = z.infer<typeof inspectionTemplateSchema>

// ============================================================================
// Field Values
// ============================================================================

/**
 * Schema for a field value during inspection
 */
export const inspectionFieldValueSchema = z.object({
  templateFieldId: z.string().length(21),
  checkboxValue: z.boolean().optional().nullable(),
  ratingValue: z.number().int().min(0).max(10).optional().nullable(),
  textValue: z.string().max(5000).optional().nullable(),
  numberValue: z.number().optional().nullable(),
  selectValue: z.string().max(255).optional().nullable(),
  hasIssue: z.boolean().default(false),
})

export type InspectionFieldValueInput = z.infer<typeof inspectionFieldValueSchema>

// ============================================================================
// Inspection Items
// ============================================================================

/**
 * Schema for an inspection item
 */
export const inspectionItemSchema = z.object({
  reservationItemId: z.string().length(21),
  productUnitId: z.string().length(21).optional().nullable(),
  overallCondition: conditionRatingSchema,
  notes: z.string().max(5000).optional().nullable(),
  fieldValues: z.array(inspectionFieldValueSchema).default([]),
})

export type InspectionItemInput = z.infer<typeof inspectionItemSchema>

// ============================================================================
// Create Inspection
// ============================================================================

/**
 * Schema for creating a new inspection
 */
export const createInspectionSchema = z.object({
  reservationId: z.string().length(21),
  type: inspectionTypeSchema,
  templateId: z.string().length(21).optional().nullable(),
  notes: z.string().max(10000).optional().nullable(),
  items: z.array(inspectionItemSchema).min(1),
})

export type CreateInspectionInput = z.infer<typeof createInspectionSchema>

// ============================================================================
// Update Inspection
// ============================================================================

/**
 * Schema for updating inspection notes
 */
export const updateInspectionNotesSchema = z.object({
  notes: z.string().max(10000).optional().nullable(),
})

/**
 * Schema for updating an inspection item
 */
export const updateInspectionItemSchema = z.object({
  overallCondition: conditionRatingSchema.optional(),
  notes: z.string().max(5000).optional().nullable(),
  fieldValues: z.array(inspectionFieldValueSchema).optional(),
})

// ============================================================================
// Complete Inspection
// ============================================================================

/**
 * Schema for completing an inspection
 */
export const completeInspectionSchema = z.object({
  notes: z.string().max(10000).optional().nullable(),
  hasDamage: z.boolean(),
  damageDescription: z.string().max(5000).optional().nullable(),
  estimatedDamageCost: z
    .number()
    .min(0)
    .max(1000000)
    .optional()
    .nullable()
    .transform((val) => (val === undefined ? null : val)),
})

export type CompleteInspectionInput = z.infer<typeof completeInspectionSchema>

// ============================================================================
// Sign Inspection
// ============================================================================

/**
 * Schema for customer signature
 */
export const signInspectionSchema = z.object({
  customerSignature: z.string().min(100).max(500000), // Base64 signature image
})

export type SignInspectionInput = z.infer<typeof signInspectionSchema>

// ============================================================================
// Photo Upload
// ============================================================================

/**
 * Schema for photo upload
 */
export const uploadInspectionPhotoSchema = z.object({
  inspectionItemId: z.string().length(21),
  fieldValueId: z.string().length(21).optional().nullable(),
  caption: z.string().max(500).optional().nullable(),
})

export type UploadInspectionPhotoInput = z.infer<typeof uploadInspectionPhotoSchema>

// ============================================================================
// Damage Recording
// ============================================================================

/**
 * Schema for recording damage
 */
export const recordDamageSchema = z.object({
  inspectionId: z.string().length(21),
  description: z.string().min(10).max(2000),
  estimatedCost: z.number().min(0).max(1000000).optional().nullable(),
  setUnitToMaintenance: z.boolean().default(true),
})

export type RecordDamageInput = z.infer<typeof recordDamageSchema>
