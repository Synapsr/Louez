import { db, stores } from '@louez/db'
import type {
  UpdateStoreAppearanceInput,
  UpdateStoreLegalInput,
} from '@louez/validations'
import { eq } from 'drizzle-orm'

interface UpdateStoreLegalParams {
  storeId: string
  input: UpdateStoreLegalInput
}

interface UpdateStoreAppearanceParams {
  storeId: string
  input: UpdateStoreAppearanceInput
}

export async function updateStoreLegal(params: UpdateStoreLegalParams) {
  const { storeId, input } = params
  const { cgv, legalNotice } = input

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  }

  if (cgv !== undefined) {
    updateData.cgv = cgv
  }

  if (legalNotice !== undefined) {
    updateData.legalNotice = legalNotice
  }

  await db.update(stores).set(updateData).where(eq(stores.id, storeId))

  return { success: true as const }
}

export async function updateStoreAppearance(params: UpdateStoreAppearanceParams) {
  const { storeId, input } = params
  const { logoUrl, darkLogoUrl, theme } = input

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  }

  if (logoUrl !== undefined) {
    updateData.logoUrl = logoUrl
  }

  if (darkLogoUrl !== undefined) {
    updateData.darkLogoUrl = darkLogoUrl
  }

  if (theme) {
    updateData.theme = theme
  }

  await db.update(stores).set(updateData).where(eq(stores.id, storeId))

  return { success: true as const }
}
