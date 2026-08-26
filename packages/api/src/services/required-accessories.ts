export interface RequiredAccessoryLine {
  parentProductId: string;
  accessoryProductId: string;
  quantity: number;
}

export interface MissingRequiredAccessory {
  parentProductId: string;
  accessoryProductId: string;
  requiredQuantity: number;
  providedQuantity: number;
}

export function validateRequiredAccessoryLines(params: {
  lines: Array<{ productId: string; quantity: number }>;
  requiredAccessories: RequiredAccessoryLine[];
}):
  | { valid: true; missing: [] }
  | { valid: false; missing: MissingRequiredAccessory[] } {
  const quantityByProductId = new Map<string, number>();
  for (const line of params.lines) {
    quantityByProductId.set(
      line.productId,
      (quantityByProductId.get(line.productId) ?? 0) + line.quantity,
    );
  }

  const requiredByAccessory = new Map<
    string,
    { parentProductId: string; accessoryProductId: string; quantity: number }
  >();
  for (const link of params.requiredAccessories) {
    const parentQuantity = quantityByProductId.get(link.parentProductId) ?? 0;
    if (parentQuantity === 0) {
      continue;
    }

    const requiredQuantity = parentQuantity * Math.max(1, link.quantity);
    const current = requiredByAccessory.get(link.accessoryProductId);
    requiredByAccessory.set(link.accessoryProductId, {
      parentProductId: current?.parentProductId ?? link.parentProductId,
      accessoryProductId: link.accessoryProductId,
      quantity: (current?.quantity ?? 0) + requiredQuantity,
    });
  }

  const missing = [...requiredByAccessory.values()].flatMap((requirement) => {
    const providedQuantity =
      quantityByProductId.get(requirement.accessoryProductId) ?? 0;
    return providedQuantity < requirement.quantity
      ? [
          {
            parentProductId: requirement.parentProductId,
            accessoryProductId: requirement.accessoryProductId,
            requiredQuantity: requirement.quantity,
            providedQuantity,
          },
        ]
      : [];
  });

  return missing.length > 0
    ? { valid: false, missing }
    : { valid: true, missing: [] };
}
