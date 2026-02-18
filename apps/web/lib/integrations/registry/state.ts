import type {
  IntegrationData,
  IntegrationStateSettings,
  StoreSettings,
} from '@louez/types'

function getBaseSettings(
  settings: StoreSettings | null | undefined,
): StoreSettings {
  if (settings) {
    return { ...settings }
  }

  return {
    reservationMode: 'payment',
    advanceNoticeMinutes: 1440,
  }
}

export function getIntegrationState(
  settings: StoreSettings | null | undefined,
  integrationId: string,
): IntegrationStateSettings | null {
  const state = settings?.integrationData?.states?.[integrationId]
  if (!state) {
    return null
  }

  return state
}

export function hasExplicitIntegrationState(
  settings: StoreSettings | null | undefined,
  integrationId: string,
): boolean {
  return Boolean(getIntegrationState(settings, integrationId))
}

export function isIntegrationEnabled(
  settings: StoreSettings | null | undefined,
  integrationId: string,
  legacyEnabled = false,
): boolean {
  const state = getIntegrationState(settings, integrationId)
  if (!state || typeof state.enabled !== 'boolean') {
    return legacyEnabled
  }

  return state.enabled
}

export function setIntegrationEnabledState(
  settings: StoreSettings | null | undefined,
  integrationId: string,
  enabled: boolean,
): StoreSettings {
  const base = getBaseSettings(settings)
  const integrationData: IntegrationData = {
    ...(base.integrationData || {}),
    states: {
      ...(base.integrationData?.states || {}),
      [integrationId]: {
        ...(base.integrationData?.states?.[integrationId] || {}),
        enabled,
      },
    },
  }

  return {
    ...base,
    integrationData,
  }
}
