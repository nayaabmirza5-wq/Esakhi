export const userRoles = ['customer', 'buyer', 'staff', 'admin', 'city_admin', 'seller', 'delivery_partner', 'super_admin'] as const;

export type UserRole = typeof userRoles[number];

export function isRoleAllowed(role: UserRole | undefined, allowedRoles: readonly UserRole[]): boolean {
  if (role === undefined) return false;
  if (allowedRoles.includes(role)) return true;
  if (role === 'buyer' && allowedRoles.includes('customer')) return true;
  if (role === 'customer' && allowedRoles.includes('buyer')) return true;
  return false;
}
