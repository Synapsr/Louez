'use client'

import { createContext, useContext } from 'react'

export interface InstanceConfig {
  /** Single-store, single-origin deployment (any LOUEZ_MODE but 'platform'). */
  standalone: boolean
  /** Whether an outgoing email transport (SMTP) is configured. */
  emailConfigured: boolean
  /** Whether Google OAuth sign-in is configured. */
  googleAuthConfigured: boolean
}

// Defaults mirror the platform/cloud deployment so a component rendered
// outside the provider (tests, isolated stories) behaves like today.
const InstanceConfigContext = createContext<InstanceConfig>({
  standalone: false,
  emailConfigured: true,
  googleAuthConfigured: true,
})

/**
 * Exposes server-only instance capabilities to client components.
 *
 * The deployment mode and configured-integration flags live in server env
 * vars (never NEXT_PUBLIC_*: the published Docker image is built without
 * them), so the root layout computes them server-side and hands them to the
 * client tree through this provider.
 */
export function InstanceProvider({
  config,
  children,
}: {
  config: InstanceConfig
  children: React.ReactNode
}) {
  return (
    <InstanceConfigContext.Provider value={config}>
      {children}
    </InstanceConfigContext.Provider>
  )
}

export function useInstanceConfig(): InstanceConfig {
  return useContext(InstanceConfigContext)
}
