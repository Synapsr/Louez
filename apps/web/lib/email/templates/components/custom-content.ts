import type { EmailCustomContent } from "@louez/types";

interface CustomContentValues {
  name: string;
  number: string;
}

const interpolate = (text: string, values: CustomContentValues) =>
  text.replaceAll("{name}", values.name).replaceAll("{number}", values.number);

/**
 * One implementation of the store-configurable email content contract:
 * greeting/message/signature overrides with {name} and {number} placeholders,
 * falling back to the template defaults.
 */
export function resolveCustomContent(
  customContent: EmailCustomContent | undefined,
  defaults: { greeting: string; signature: string },
  values: CustomContentValues,
): { greeting: string; message: string | null; signature: string } {
  return {
    greeting: interpolate(customContent?.greeting || defaults.greeting, values),
    message: customContent?.message ? interpolate(customContent.message, values) : null,
    signature: customContent?.signature || defaults.signature,
  };
}
