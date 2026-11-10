import type { StoreMetrics } from '@louez/api/services/store-metrics';

/**
 * How the dashboard's home adapts to the store. Its figures come from
 * `getStoreMetrics` (packages/api), which the statistics procedures share.
 */

/**
 * Store state based on metrics
 */
export type StoreState =
  | 'virgin' // No products
  | 'building' // Has products, no customers
  | 'starting' // Has customers, few reservations
  | 'active' // Regular activity
  | 'established'; // High volume

/**
 * Determine the store state based on metrics
 */
export function determineStoreState(metrics: StoreMetrics): StoreState {
  const { activeProductCount, customerCount, completedReservations } = metrics;

  if (activeProductCount === 0) {
    return 'virgin';
  }

  if (customerCount === 0) {
    return 'building';
  }

  if (completedReservations < 5) {
    return 'starting';
  }

  if (completedReservations < 50) {
    return 'active';
  }

  return 'established';
}

/**
 * Get the time of day for contextual greetings
 */
export function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getHours();

  if (hour >= 6 && hour < 12) {
    return 'morning';
  }

  if (hour >= 12 && hour < 18) {
    return 'afternoon';
  }

  return 'evening';
}
