export type EmbedSlotGroupPeriod = "morning" | "afternoon" | "evening";

export interface EmbedSlotGroup {
  /** The first slot of the group; stable as a React key. */
  key: string;
  period: EmbedSlotGroupPeriod;
  slots: string[];
}

const toMinutes = (time: string): number => {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const periodOf = (time: string): EmbedSlotGroupPeriod => {
  const hour = toMinutes(time) / 60;
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
};

/**
 * Splits a day's slots into contiguous runs: a gap wider than the interval
 * means the store closed in between (the lunch break), and each run reads
 * as its own block in the hour grid.
 */
export const groupEmbedSlots = (slots: string[], intervalMinutes: number): EmbedSlotGroup[] => {
  const groups: EmbedSlotGroup[] = [];
  for (const slot of slots) {
    const current = groups.at(-1);
    const previous = current?.slots.at(-1);
    if (
      current &&
      previous !== undefined &&
      toMinutes(slot) - toMinutes(previous) === intervalMinutes
    ) {
      current.slots.push(slot);
    } else {
      groups.push({ key: slot, period: periodOf(slot), slots: [slot] });
    }
  }
  return groups;
};
