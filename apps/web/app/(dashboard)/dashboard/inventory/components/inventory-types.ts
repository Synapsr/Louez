import type { UnitConflict } from '@/lib/utils/unit-conflicts';

export type InventoryProductOption = {
  id: string;
  name: string;
  trackUnits: boolean;
  quantity: number;
};

export type InventoryConflict = UnitConflict;
