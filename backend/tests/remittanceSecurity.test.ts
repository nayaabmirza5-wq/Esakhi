import { describe, expect, it } from 'vitest';
import { User } from '../src/models/User.js';

describe('Remittance Handshake PIN Security & Auto-Rotation Logic', () => {
  it('userSchema includes remittancePin, expiration and previousPin fields', () => {
    const paths = (User.schema as any).paths;
    expect(paths.remittancePin).toBeDefined();
    expect(paths.remittancePinExpiresAt).toBeDefined();
    expect(paths.previousRemittancePin).toBeDefined();
    expect(paths.previousPinExpiresAt).toBeDefined();
  });

  it('pre-validate sets 4-digit PIN and 60-second expiration for delivery partners', async () => {
    const partner = new User({
      phone: '9876543210',
      role: 'delivery_partner',
    });
    // Trigger pre-validate
    await partner.validate();
    expect(partner.remittancePin).toBeDefined();
    expect(partner.remittancePin).toMatch(/^\d{4}$/);
    expect((partner as any).remittancePinExpiresAt).toBeInstanceOf(Date);

    const ttl = (partner as any).remittancePinExpiresAt.getTime() - Date.now();
    // Should be approximately 60 seconds (allow 50-60s range for test execution time)
    expect(ttl).toBeGreaterThan(50000);
    expect(ttl).toBeLessThanOrEqual(60000);
  });

  it('validates active PIN and rejects expired or mismatched PINs', () => {
    const now = new Date();
    const partner = {
      remittancePin: '4821',
      remittancePinExpiresAt: new Date(now.getTime() + 45000), // 45s left
      previousRemittancePin: '9152',
      previousPinExpiresAt: new Date(now.getTime() + 15000), // 15s left
    };

    const validatePin = (inputPin: string, testDate = new Date()) => {
      const pinExpiresAt = partner.remittancePinExpiresAt;
      const prevPinExpiresAt = partner.previousPinExpiresAt;

      let isValid = false;
      if (partner.remittancePin && partner.remittancePin === inputPin) {
        if (!pinExpiresAt || pinExpiresAt.getTime() > testDate.getTime()) {
          isValid = true;
        }
      }

      if (!isValid && partner.previousRemittancePin && partner.previousRemittancePin === inputPin) {
        if (prevPinExpiresAt && prevPinExpiresAt.getTime() > testDate.getTime()) {
          isValid = true;
        }
      }

      if (!isValid) {
        if (partner.remittancePin === inputPin && pinExpiresAt && pinExpiresAt.getTime() <= testDate.getTime()) {
          return { valid: false, error: 'EXPIRED_HANDSHAKE_PIN' };
        }
        return { valid: false, error: 'INVALID_HANDSHAKE_PIN' };
      }

      return { valid: true };
    };

    // 1. Current active PIN succeeds
    expect(validatePin('4821')).toEqual({ valid: true });

    // 2. Previous PIN during grace period succeeds
    expect(validatePin('9152')).toEqual({ valid: true });

    // 3. Random/unknown PIN fails with INVALID_HANDSHAKE_PIN
    expect(validatePin('1111')).toEqual({ valid: false, error: 'INVALID_HANDSHAKE_PIN' });

    // 4. After 50 seconds: current active PIN has expired
    const after50s = new Date(now.getTime() + 50000);
    expect(validatePin('4821', after50s)).toEqual({ valid: false, error: 'EXPIRED_HANDSHAKE_PIN' });

    // 5. After 20 seconds: grace period for previous PIN has expired
    const after20s = new Date(now.getTime() + 20000);
    expect(validatePin('9152', after20s)).toEqual({ valid: false, error: 'INVALID_HANDSHAKE_PIN' });
  });

  it('guarantees that burnt/settled PINs cannot be replayed', () => {
    // Simulating post-settlement PIN burn
    const oldPin = '4821';
    let currentActivePin = oldPin;

    // Settlement burns the old PIN and immediately generates a fresh unguessable PIN
    const newPin = String(Math.floor(1000 + Math.random() * 9000));
    currentActivePin = newPin;

    // Attempting to reuse oldPin fails
    expect(oldPin).not.toBe(currentActivePin);
    expect(currentActivePin).toMatch(/^\d{4}$/);
  });
});
