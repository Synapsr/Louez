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
  const { cgv, legalNotice, includeFullCgvInContract } = input

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  }

  if (cgv !== undefined) {
    updateData.cgv = cgv
  }

  if (legalNotice !== undefined) {
    updateData.legalNotice = legalNotice
  }

  if (includeFullCgvInContract !== undefined) {
    updateData.includeCgvInContract = includeFullCgvInContract
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
    const currentStore = await db.query.stores.findFirst({
      where: eq(stores.id, storeId),
      columns: {
        theme: true,
      },
    })

    const existingTheme = currentStore?.theme ?? null

    const mergedTheme: {
      mode: 'light' | 'dark'
      primaryColor: string
      heroImages?: string[]
      maxDiscountPercent?: number | null
    } = {
      mode: theme.mode,
      primaryColor: theme.primaryColor,
    }

    if (existingTheme?.heroImages !== undefined) {
      mergedTheme.heroImages = existingTheme.heroImages
    }

    if (existingTheme?.maxDiscountPercent !== undefined) {
      mergedTheme.maxDiscountPercent = existingTheme.maxDiscountPercent
    }

    if (theme.heroImages !== undefined) {
      mergedTheme.heroImages = theme.heroImages
    }

    if (theme.maxDiscountPercent !== undefined) {
      mergedTheme.maxDiscountPercent = theme.maxDiscountPercent
    }

    updateData.theme = mergedTheme
  }

  await db.update(stores).set(updateData).where(eq(stores.id, storeId))

  return { success: true as const }
}
