/**
 * The reservation lines each unit came back on, for the repair downtimes
 * suggested after a return: a downtime may leave out only the lines that
 * hold its own unit (the API refuses any other).
 */
export function reservationLinesByUnit(
  items: ReadonlyArray<{ reservationItemId: string; productUnitId: string | null }>,
): Map<string, string[]> {
  const lines = new Map<string, string[]>();
  for (const item of items) {
    if (!item.productUnitId) continue;
    const unitLines = lines.get(item.productUnitId) ?? [];
    if (!unitLines.includes(item.reservationItemId)) unitLines.push(item.reservationItemId);
    lines.set(item.productUnitId, unitLines);
  }
  return lines;
}
