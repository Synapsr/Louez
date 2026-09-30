/** What these helpers read of a template: the stable keys of its fields. */
interface TemplateFields {
  fields: readonly { key?: string }[];
}

/** How many templates an empty tab puts forward. */
const FEATURED_COUNT = 3;

/** Every field of the template is already in the store: adopting it again adds nothing. */
export const isTemplateAdopted = (
  template: TemplateFields,
  adoptedKeys: ReadonlySet<string>,
): boolean =>
  template.fields.every((field) => field.key !== undefined && adoptedKeys.has(field.key));

/**
 * The templates worth showing first: the ones suggested for this store, or,
 * when none fits it, those of the tab not taken yet (a rental shop's first
 * per-item fields are skis or bikes either way).
 */
export const listFeaturedTemplates = <TTemplate extends TemplateFields>({
  templates,
  suggestions,
  adoptedKeys,
}: {
  templates: readonly TTemplate[];
  suggestions: readonly TTemplate[];
  adoptedKeys: ReadonlySet<string>;
}): TTemplate[] =>
  (suggestions.length > 0
    ? [...suggestions]
    : templates.filter((template) => !isTemplateAdopted(template, adoptedKeys))
  ).slice(0, FEATURED_COUNT);
