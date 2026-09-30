import type { CustomerFieldWidth, CustomerProfileFieldKey } from "@louez/types";
import type { CustomerExtraLayoutItem } from "@louez/validations";

/** One item of a storefront form's extra block, with the field it shows. */
export type CustomerExtraItem<TProfileField, TCustomField> =
  | {
      kind: "builtin";
      key: CustomerProfileFieldKey;
      width: CustomerFieldWidth;
      field: TProfileField;
    }
  | { kind: "custom"; key: string; width: CustomerFieldWidth; field: TCustomField };

/**
 * The extra block's fields in the owner's layout (`customerLayout` of
 * `forCart` or `myValues`). A layout entry whose field this form does not
 * show (not editable here, another customer type) is left out.
 */
export const joinCustomerExtraLayout = <
  TProfileField extends { key: CustomerProfileFieldKey },
  TCustomField extends { id: string },
>(
  layout: readonly CustomerExtraLayoutItem[],
  profileFields: readonly TProfileField[],
  customFields: readonly TCustomField[],
): CustomerExtraItem<TProfileField, TCustomField>[] => {
  const profileByKey = new Map(profileFields.map((field) => [field.key, field]));
  const customById = new Map(customFields.map((field) => [field.id, field]));
  return layout.flatMap((entry): CustomerExtraItem<TProfileField, TCustomField>[] => {
    if (entry.kind === "builtin") {
      const field = profileByKey.get(entry.key);
      return field ? [{ ...entry, field }] : [];
    }
    const field = customById.get(entry.key);
    return field ? [{ ...entry, field }] : [];
  });
};
