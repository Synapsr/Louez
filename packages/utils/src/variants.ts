import type {
  BookingAttributeAxis,
  CombinationAvailability,
  UnitAttributes,
} from '@louez/types'

export const DEFAULT_COMBINATION_KEY = '__default'
export const MAX_BOOKING_ATTRIBUTE_AXES = 3

function normalizeToken(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function normalizeAxisKey(value: string): string {
  return normalizeToken(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function normalizeAttributeValue(value: string): string {
  return normalizeToken(value)
}

export function getSortedAxes(
  axes: BookingAttributeAxis[] | null | undefined,
): BookingAttributeAxis[] {
  return [...(axes || [])].sort((a, b) => a.position - b.position)
}

export function canonicalizeAttributes(
  axes: BookingAttributeAxis[] | null | undefined,
  attributes: UnitAttributes | null | undefined,
): UnitAttributes {
  const source = attributes || {}
  const sortedAxes = getSortedAxes(axes)

  if (sortedAxes.length === 0) {
    return {}
  }

  const normalized: UnitAttributes = {}
  for (const axis of sortedAxes) {
    const rawValue = source[axis.key]
    if (typeof rawValue !== 'string') {
      continue
    }
    const normalizedValue = normalizeAttributeValue(rawValue)
    if (!normalizedValue) {
      continue
    }
    normalized[axis.key] = normalizedValue
  }

  return normalized
}

export function hasCompleteAttributes(
  axes: BookingAttributeAxis[] | null | undefined,
  attributes: UnitAttributes | null | undefined,
): boolean {
  const sortedAxes = getSortedAxes(axes)
  if (sortedAxes.length === 0) {
    return true
  }

  const normalized = canonicalizeAttributes(axes, attributes)
  return sortedAxes.every((axis) => Boolean(normalized[axis.key]))
}

export function buildCombinationKey(
  axes: BookingAttributeAxis[] | null | undefined,
  attributes: UnitAttributes | null | undefined,
): string {
  const sortedAxes = getSortedAxes(axes)
  if (sortedAxes.length === 0) {
    return DEFAULT_COMBINATION_KEY
  }

  const normalized = canonicalizeAttributes(axes, attributes)
  const tokens: string[] = []

  for (const axis of sortedAxes) {
    const value = normalized[axis.key]
    if (!value) {
      return DEFAULT_COMBINATION_KEY
    }
    tokens.push(`${axis.key}:${value}`)
  }

  return tokens.join('|')
}

export function buildPartialCombinationKey(
  axes: BookingAttributeAxis[] | null | undefined,
  attributes: UnitAttributes | null | undefined,
): string {
  const sortedAxes = getSortedAxes(axes)
  if (sortedAxes.length === 0) {
    return DEFAULT_COMBINATION_KEY
  }

  const normalized = canonicalizeAttributes(axes, attributes)
  const tokens: string[] = []

  for (const axis of sortedAxes) {
    const value = normalized[axis.key]
    if (value) {
      tokens.push(`${axis.key}:${value}`)
    }
  }

  return tokens.length > 0 ? tokens.join('|') : DEFAULT_COMBINATION_KEY
}

export function matchesSelectedAttributes(
  selectedAttributes: UnitAttributes | null | undefined,
  candidateAttributes: UnitAttributes | null | undefined,
): boolean {
  const selected = selectedAttributes || {}
  const candidate = candidateAttributes || {}

  for (const [key, value] of Object.entries(selected)) {
    const normalizedValue = normalizeAttributeValue(value)
    if (!normalizedValue) {
      continue
    }
    if (normalizeAttributeValue(candidate[key] || '') !== normalizedValue) {
      return false
    }
  }

  return true
}

export function getDeterministicCombinationSortValue(
  axes: BookingAttributeAxis[] | null | undefined,
  attributes: UnitAttributes | null | undefined,
): string {
  const sortedAxes = getSortedAxes(axes)
  const normalized = canonicalizeAttributes(axes, attributes)
  if (sortedAxes.length === 0) {
    return DEFAULT_COMBINATION_KEY
  }

  return sortedAxes
    .map((axis) => `${axis.key}:${normalized[axis.key] || ''}`)
    .join('|')
}

type CombinationLike = Pick<
  CombinationAvailability,
  'combinationKey' | 'selectedAttributes' | 'availableQuantity'
>

export type SelectionMode = 'none' | 'partial' | 'full'
export type SelectionAllocationMode = 'single' | 'split'

export interface SelectionCapacity {
  mode: SelectionMode
  allocationMode: SelectionAllocationMode
  capacity: number
}

export function getMatchingCombinations<T extends CombinationLike>(
  combinations: T[] | null | undefined,
  selectedAttributes: UnitAttributes | null | undefined,
): T[] {
  return (combinations || []).filter((combination) =>
    matchesSelectedAttributes(selectedAttributes, combination.selectedAttributes),
  )
}

export function getMaxAvailableForSelection(
  combinations: CombinationLike[] | null | undefined,
  selectedAttributes: UnitAttributes | null | undefined,
): number {
  const matching = getMatchingCombinations(combinations, selectedAttributes)
  if (matching.length === 0) {
    return 0
  }

  return matching.reduce((max, combination) => {
    return Math.max(max, combination.availableQuantity || 0)
  }, 0)
}

export function getTotalAvailableForSelection(
  combinations: CombinationLike[] | null | undefined,
  selectedAttributes: UnitAttributes | null | undefined,
): number {
  const matching = getMatchingCombinations(combinations, selectedAttributes)
  if (matching.length === 0) {
    return 0
  }

  return matching.reduce((sum, combination) => {
    return sum + Math.max(0, combination.availableQuantity || 0)
  }, 0)
}

export function getSelectionMode(
  axes: BookingAttributeAxis[] | null | undefined,
  selectedAttributes: UnitAttributes | null | undefined,
): SelectionMode {
  const sortedAxes = getSortedAxes(axes)
  if (sortedAxes.length === 0) {
    return 'none'
  }

  const normalizedSelectedAttributes = canonicalizeAttributes(axes, selectedAttributes)
  const selectedCount = Object.keys(normalizedSelectedAttributes).length

  if (selectedCount === 0) {
    return 'none'
  }

  if (selectedCount >= sortedAxes.length) {
    return 'full'
  }

  return 'partial'
}

export function getSelectionCapacity(
  axes: BookingAttributeAxis[] | null | undefined,
  combinations: CombinationLike[] | null | undefined,
  selectedAttributes: UnitAttributes | null | undefined,
): SelectionCapacity {
  const mode = getSelectionMode(axes, selectedAttributes)

  if (mode === 'full') {
    return {
      mode,
      allocationMode: 'single',
      capacity: getMaxAvailableForSelection(combinations, selectedAttributes),
    }
  }

  return {
    mode,
    allocationMode: 'split',
    capacity: getTotalAvailableForSelection(combinations, selectedAttributes),
  }
}

export function resolveBestCombination<T extends CombinationLike>(
  axes: BookingAttributeAxis[] | null | undefined,
  combinations: T[] | null | undefined,
  selectedAttributes: UnitAttributes | null | undefined,
  quantity: number,
): T | null {
  const matching = getMatchingCombinations(combinations, selectedAttributes).sort(
    (a, b) => {
      const sortA = getDeterministicCombinationSortValue(axes, a.selectedAttributes)
      const sortB = getDeterministicCombinationSortValue(axes, b.selectedAttributes)
      return sortA.localeCompare(sortB, 'en')
    },
  )

  return matching.find((combination) => combination.availableQuantity >= quantity) || null
}

export function allocateAcrossCombinations<T extends CombinationLike>(
  axes: BookingAttributeAxis[] | null | undefined,
  combinations: T[] | null | undefined,
  selectedAttributes: UnitAttributes | null | undefined,
  quantity: number,
): Array<{ combination: T; quantity: number }> | null {
  if (quantity < 1) {
    return []
  }

  const matching = getMatchingCombinations(combinations, selectedAttributes).sort(
    (a, b) => {
      const sortA = getDeterministicCombinationSortValue(axes, a.selectedAttributes)
      const sortB = getDeterministicCombinationSortValue(axes, b.selectedAttributes)
      return sortA.localeCompare(sortB, 'en')
    },
  )

  let remaining = quantity
  const allocations: Array<{ combination: T; quantity: number }> = []

  for (const combination of matching) {
    if (remaining <= 0) break
    const available = Math.max(0, combination.availableQuantity || 0)
    if (available === 0) continue

    const take = Math.min(available, remaining)
    allocations.push({ combination, quantity: take })
    remaining -= take
  }

  if (remaining > 0) {
    return null
  }

  return allocations
}
