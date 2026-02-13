export type Permission =
  | 'read'
  | 'write'
  | 'delete'
  | 'manage_members'
  | 'manage_settings'

export type MemberRole = 'owner' | 'member' | 'platform_admin'

const ROLE_PERMISSIONS: Record<MemberRole, Permission[]> = {
  owner: ['read', 'write', 'delete', 'manage_members', 'manage_settings'],
  member: ['read', 'write'],
  platform_admin: [
    'read',
    'write',
    'delete',
    'manage_members',
    'manage_settings',
  ],
}

export function hasPermission(
  role: MemberRole,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}
