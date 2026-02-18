import type {
  StoreSettings,
  TulipContractType,
  TulipIntegrationSettings,
  TulipPublicMode,
} from '@louez/types'

import { isIntegrationEnabled } from '@/lib/integrations/registry/state'

import { decryptTulipApiKey } from './crypto'

export interface TulipResolvedSettings {
  enabled: boolean
  apiKeyEncrypted: string | null
  apiKeyLast4: string | null
  connectedAt: string | null
  publicMode: TulipPublicMode
  includeInFinalPrice: boolean
  renterUid: string | null
  contractType: TulipContractType
}

export const DEFAULT_TULIP_SETTINGS: Omit<TulipResolvedSettings, 'enabled' | 'apiKeyEncrypted' | 'apiKeyLast4' | 'connectedAt' | 'renterUid'> = {
  publicMode: 'required',
  includeInFinalPrice: true,
  contractType: 'LCD',
}

export function getTulipSettings(settings: StoreSettings | null | undefined): TulipResolvedSettings {
  const raw = settings?.integrationData?.tulip || {}
  const isConnected = Boolean(raw.apiKeyEncrypted && raw.renterUid)
  const enabled = isIntegrationEnabled(settings, 'tulip', isConnected)
  const storedPublicMode = raw.publicMode ?? DEFAULT_TULIP_SETTINGS.publicMode

  return {
    enabled,
    apiKeyEncrypted: raw.apiKeyEncrypted ?? null,
    apiKeyLast4: raw.apiKeyLast4 ?? null,
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

export function getTulipApiKey(settings: StoreSettings | null | undefined): string | null {
  const encrypted = settings?.integrationData?.tulip?.apiKeyEncrypted
  if (!encrypted) {
    return null
  }

  return decryptTulipApiKey(encrypted)
}

export function isTulipConnected(settings: StoreSettings | null | undefined): boolean {
  const tulipSettings = getTulipSettings(settings)
  return Boolean(
    tulipSettings.enabled &&
      tulipSettings.apiKeyEncrypted &&
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
