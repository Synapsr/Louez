export type Permission =
  | 'read'
  | 'write'
  | 'delete'
  | 'manage_members'
  | 'manage_settings'

export type MemberRole = 'owner' | 'admin' | 'member' | 'platform_admin'

const ROLE_PERMISSIONS: Record<MemberRole, Permission[]> = {
  owner: ['read', 'write', 'delete', 'manage_members', 'manage_settings'],
  admin: ['read', 'write', 'manage_members'],
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
