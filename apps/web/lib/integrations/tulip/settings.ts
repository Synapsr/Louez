import type {
  StoreSettings,
  TulipContractType,
  TulipIntegrationSettings,
  TulipPublicMode,
} from '@louez/types'

import { env } from '@/env'

export interface TulipResolvedSettings {
  enabled: boolean
  connectedAt: string | null
  publicMode: TulipPublicMode
  includeInFinalPrice: boolean
  renterUid: string | null
  contractType: TulipContractType
}

export const DEFAULT_TULIP_SETTINGS: Omit<TulipResolvedSettings, 'enabled' | 'connectedAt' | 'renterUid'> = {
  publicMode: 'required',
  includeInFinalPrice: true,
  contractType: 'LCD',
}

export function getTulipSettings(settings: StoreSettings | null | undefined): TulipResolvedSettings {
  const raw = settings?.integrationData?.tulip || {}
  const apiKey = getTulipApiKey(settings)
  const isConnected = Boolean(apiKey && raw.renterUid)
  const enabled = isConnected
  const storedPublicMode = raw.publicMode ?? DEFAULT_TULIP_SETTINGS.publicMode

  return {
    enabled,
    connectedAt: raw.connectedAt ?? null,
    publicMode: enabled ? storedPublicMode : 'no_public',
    includeInFinalPrice: raw.includeInFinalPrice ?? DEFAULT_TULIP_SETTINGS.includeInFinalPrice,
    renterUid: raw.renterUid ?? null,
    contractType: raw.contractType ?? DEFAULT_TULIP_SETTINGS.contractType,
  }
}

export function mergeTulipSettings(
  current: StoreSettings | null | undefined,
  patch: Partial<TulipIntegrationSettings>,
): StoreSettings {
  const base: StoreSettings = current ? { ...current } : {
    reservationMode: 'payment',
    advanceNoticeMinutes: 1440,
  }

  const previousTulip = base.integrationData?.tulip || {}
  return {
    ...base,
    integrationData: {
      ...(base.integrationData || {}),
      tulip: {
        ...previousTulip,
        ...patch,
      },
    },
  }
}

export function getTulipApiKey(settings?: StoreSettings | null | undefined): string | null {
  void settings
  const apiKey = env.TULIP_API_KEY?.trim()
  if (!apiKey) {
    return null
  }

  return apiKey
}

export function isTulipConnected(settings: StoreSettings | null | undefined): boolean {
  const tulipSettings = getTulipSettings(settings)
  return Boolean(
    getTulipApiKey(settings) &&
      tulipSettings.renterUid,
  )
}

export function shouldApplyTulipInsurance(
  mode: TulipPublicMode,
  optIn: boolean | undefined,
): boolean {
  if (mode === 'no_public') return false
  if (mode === 'required') return true
  return optIn !== false
}
