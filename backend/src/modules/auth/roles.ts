export const userRoles = ['customer', 'staff', 'admin', 'city_admin', 'seller', 'delivery_partner', 'super_admin'] as const;

export type UserRole = typeof userRoles[number];

export function isRoleAllowed(role: UserRole | undefined, allowedRoles: readonly UserRole[]): boolean {
  return role !== undefined && allowedRoles.includes(role);
}
