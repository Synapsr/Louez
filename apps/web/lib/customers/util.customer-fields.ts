import type { CustomerFieldDefinition } from "@louez/types";

export interface CustomerFieldSection<T> {
  name: string;
  fields: T[];
}

type Positioned = Pick<CustomerFieldDefinition, "id" | "section" | "position">;

/**
 * Fields grouped by section. A section has no row of its own: it exists
 * through its fields and sits where its first field does.
 */
export const groupFieldsBySection = <T extends Positioned>(
  fields: readonly T[],
): CustomerFieldSection<T>[] => {
  const sections = new Map<string, T[]>();
  for (const field of [...fields].sort((a, b) => a.position - b.position)) {
    sections.set(field.section, [...(sections.get(field.section) ?? []), field]);
  }
  return [...sections].map(([name, sectionFields]) => ({ name, fields: sectionFields }));
};

/** The payload of a reorder: every field, section by section, in display order. */
export const toReorderPayload = <T extends Positioned>(
  sections: readonly CustomerFieldSection<T>[],
) =>
  sections.flatMap((section) =>
    section.fields.map((field) => ({ id: field.id, section: section.name })),
  );

/** Moves an item of a list from one index to another, leaving the input untouched. */
export const moveItem = <T>(items: readonly T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

/** Sends a field to the end of another section (created on the fly when new). */
export const moveFieldToSection = <T extends Positioned>(
  sections: readonly CustomerFieldSection<T>[],
  fieldId: string,
  target: string,
): CustomerFieldSection<T>[] => {
  const field = sections.flatMap((section) => section.fields).find((entry) => entry.id === fieldId);
  if (!field) return [...sections];

  const without = sections
    .map((section) => ({
      ...section,
      fields: section.fields.filter((entry) => entry.id !== fieldId),
    }))
    .filter((section) => section.fields.length > 0 || section.name === target);

  return without.some((section) => section.name === target)
    ? without.map((section) =>
        section.name === target ? { ...section, fields: [...section.fields, field] } : section,
      )
    : [...without, { name: target, fields: [field] }];
};
