import type {
  StoreSettings,
  TulipIntegrationSettings,
  TulipPublicMode,
} from '@louez/types'

import { env } from '@/env'

export interface TulipResolvedSettings {
  enabled: boolean
  connectedAt: string | null
  publicMode: TulipPublicMode
  renterUid: string | null
}

export const DEFAULT_TULIP_SETTINGS: Omit<TulipResolvedSettings, 'enabled' | 'connectedAt' | 'renterUid'> = {
  publicMode: 'required',
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
    renterUid: raw.renterUid ?? null,
  }
}

function getTulipArchivedRenterUid(settings: StoreSettings | null | undefined): string | null {
  const raw = settings?.integrationData?.tulip
  const archivedRenterUid =
    typeof raw?.archivedRenterUid === 'string' ? raw.archivedRenterUid.trim() : ''
  return archivedRenterUid.length > 0 ? archivedRenterUid : null
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

export function getTulipRenterUidForContracts(
  settings: StoreSettings | null | undefined,
): string | null {
  const activeRenterUid = getTulipSettings(settings).renterUid?.trim() || null
  if (activeRenterUid) {
    return activeRenterUid
  }

  return getTulipArchivedRenterUid(settings)
}

export function shouldApplyTulipInsurance(
  mode: TulipPublicMode,
  optIn: boolean | undefined,
): boolean {
  if (mode === 'no_public') return false
  if (mode === 'required') return true
  return optIn !== false
}
