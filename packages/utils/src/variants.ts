import type { BookingAttributeAxis, UnitAttributes } from '@louez/types'

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

