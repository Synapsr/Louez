/**
 * The store-owner messages carry a trailing colon ("Client :") from the days
 * they were laid out as "label: value" lines. In a two-column row the colon
 * has nothing to point at, so the row drops it.
 */
export const stripLabelColon = (label: string) => label.replace(/\s*:\s*$/, "");
