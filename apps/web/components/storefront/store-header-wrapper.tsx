'use client'

import { StoreHeader } from './store-header'

interface StoreHeaderWrapperProps {
  storeName: string
  storeSlug: string
  logoUrl?: string | null
}

export function StoreHeaderWrapper(props: StoreHeaderWrapperProps) {
  return <StoreHeader {...props} />
}
