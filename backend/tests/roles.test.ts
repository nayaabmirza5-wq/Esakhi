import { describe, expect, it } from 'vitest';
import { isRoleAllowed, userRoles } from '../src/modules/auth/roles.js';

describe('role authorization policy', () => {
  it('recognizes Super Admin as a distinct role', () => {
    expect(userRoles).toContain('super_admin');
    expect(isRoleAllowed('super_admin', ['super_admin'])).toBe(true);
    expect(isRoleAllowed('admin', ['super_admin'])).toBe(false);
  });

  it('recognizes City Admin as separate from platform and store administrators', () => {
    expect(userRoles).toContain('city_admin');
    expect(isRoleAllowed('city_admin', ['city_admin'])).toBe(true);
    expect(isRoleAllowed('city_admin', ['admin'])).toBe(false);
    expect(isRoleAllowed('city_admin', ['super_admin'])).toBe(false);
  });

  it('recognizes sellers as a separate role with no inherited admin permissions', () => {
    expect(userRoles).toContain('seller');
    expect(isRoleAllowed('seller', ['seller'])).toBe(true);
    expect(isRoleAllowed('seller', ['admin'])).toBe(false);
    expect(isRoleAllowed('seller', ['delivery_partner'])).toBe(false);
  });

  it('denies users without the explicitly allowed role', () => {
    expect(isRoleAllowed('customer', ['super_admin'])).toBe(false);
    expect(isRoleAllowed(undefined, ['super_admin'])).toBe(false);
  });
});
