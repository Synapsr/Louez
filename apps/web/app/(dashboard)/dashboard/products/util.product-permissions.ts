import { hasPermission, type MemberRole } from "@louez/utils";

/**
 * What the current member may do to products, from their role in the store,
 * as the products procedures check it: deleting a product or a seasonal price
 * needs the delete permission.
 */
export function productPermissions(role: MemberRole) {
  return { canDelete: hasPermission(role, "delete") };
}
