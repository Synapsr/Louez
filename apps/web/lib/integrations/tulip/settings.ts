import type { TulipPublicMode } from '@louez/types';

import { env } from '@/env';

export interface TulipResolvedSettings {
  enabled: boolean;
  connectedAt: string | null;
  publicMode: TulipPublicMode;
  renterUid: string | null;
}

export const DEFAULT_TULIP_SETTINGS: Omit<
  TulipResolvedSettings,
  'enabled' | 'connectedAt' | 'renterUid'
> = {
  publicMode: 'optional',
};

export function getTulipApiKey(): string | null {
  const apiKey = env.TULIP_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  return apiKey;
}

export function shouldApplyTulipInsurance(
  mode: TulipPublicMode,
  optIn: boolean | undefined,
): boolean {
  if (mode === 'no_public') return false;
  if (mode === 'required') return true;
  return optIn !== false;
}

export function getDashboardTulipInsuranceModeFromSettings(
  settings: Pick<TulipResolvedSettings, 'enabled' | 'publicMode'>,
): TulipPublicMode {
  if (!settings.enabled) {
    return 'no_public';
  }

  // Option A: hidden on the public storefront still remains activable by the landlord.
  if (settings.publicMode === 'required') {
    return 'required';
  }

  return 'optional';
}

export function getDashboardTulipInsuranceDefaultOptInFromSettings(
  settings: Pick<TulipResolvedSettings, 'enabled' | 'publicMode'>,
): boolean {
  if (!settings.enabled) {
    return false;
  }

  if (settings.publicMode === 'required') {
    return true;
  }

  // Option A: hidden publicly, but opt-in stays a landlord decision.
  if (settings.publicMode === 'no_public') {
    return false;
  }

  return true;
}
