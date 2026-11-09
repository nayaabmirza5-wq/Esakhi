import { describe, expect, it } from 'vitest';
import { damohDeliveryPartnerOnboardingSchema } from '../src/modules/cityAdmin/deliveryPartnerApplication.schemas.js';
import { DeliveryPartner } from '../src/models/DeliveryPartner.js';

describe('Damoh Delivery Partner Onboarding & Auto-Activation', () => {
  it('exports the DeliveryPartner model properly', () => {
    expect(DeliveryPartner).toBeDefined();
    expect(DeliveryPartner.modelName).toBe('DeliveryPartner');
  });

  it('validates a complete Damoh Cycle onboarding payload with waived DL/RC', () => {
    const validCyclePayload = {
      fullName: 'Ramesh Patel',
      phone: '9876543210',
      emergencyPhone: '9876543211',
      dob: '1998-05-15',
      vehicleType: 'CYCLE' as const,
      panNumber: 'ABCDE1234F',
      aadharNumber: '123456789012',
      bankDetails: {
        accountHolderName: 'Ramesh Patel',
        bankName: 'State Bank of India',
        branchName: 'Damoh Main Branch',
        accountNumber: '123456789012',
        confirmAccountNumber: '123456789012',
        ifscCode: 'SBIN0000358',
      },
    };

    const parsed = damohDeliveryPartnerOnboardingSchema.parse(validCyclePayload);
    expect(parsed.fullName).toBe('Ramesh Patel');
    expect(parsed.vehicleType).toBe('CYCLE');
    expect(parsed.bankDetails.ifscCode).toBe('SBIN0000358');
    expect(parsed.dlNumber).toBeUndefined();
  });

  it('validates a complete Damoh Motorcycle payload requiring Parivahan DL and RC', () => {
    const validBikePayload = {
      fullName: 'Vikram Singh',
      phone: '8765432109',
      emergencyPhone: '9876543212',
      dob: '1995-10-20',
      vehicleType: 'BIKE' as const,
      dlNumber: 'MP1520210001234',
      rcNumber: 'MP15AB1234',
      panNumber: 'FGHIJ5678K',
      aadharNumber: '987654321098',
      bankDetails: {
        accountHolderName: 'Vikram Singh',
        bankName: 'HDFC Bank Ltd',
        branchName: 'Damoh Branch',
        accountNumber: '987654321098',
        confirmAccountNumber: '987654321098',
        ifscCode: 'HDFC0001234',
      },
    };

    const parsed = damohDeliveryPartnerOnboardingSchema.parse(validBikePayload);
    expect(parsed.vehicleType).toBe('BIKE');
    expect(parsed.dlNumber).toBe('MP1520210001234');
    expect(parsed.rcNumber).toBe('MP15AB1234');
  });

  it('validates an EV delivery partner payload', () => {
    const validEvPayload = {
      fullName: 'Aman Khan',
      phone: '7654321098',
      emergencyPhone: '9123456780',
      dob: '2000-01-01',
      vehicleType: 'EV' as const,
      dlNumber: 'MP1520220005678',
      rcNumber: 'MP15EV9999',
      panNumber: 'ZXCVB9876Q',
      aadharNumber: '555566667777',
      bankDetails: {
        accountHolderName: 'Aman Khan',
        bankName: 'Bank of Baroda',
        branchName: 'Damoh Civil Lines',
        accountNumber: '55556666777788',
        confirmAccountNumber: '55556666777788',
        ifscCode: 'BARB0DAMOHX',
      },
    };

    const parsed = damohDeliveryPartnerOnboardingSchema.parse(validEvPayload);
    expect(parsed.vehicleType).toBe('EV');
    expect(parsed.panNumber).toBe('ZXCVB9876Q');
  });

  it('rejects double-entry bank account mismatches', () => {
    const mismatchBankPayload = {
      fullName: 'Ramesh Patel',
      phone: '9876543210',
      emergencyPhone: '9876543211',
      dob: '1998-05-15',
      vehicleType: 'CYCLE' as const,
      panNumber: 'ABCDE1234F',
      aadharNumber: '123456789012',
      bankDetails: {
        accountHolderName: 'Ramesh Patel',
        bankName: 'State Bank of India',
        branchName: 'Damoh Main Branch',
        accountNumber: '123456789012',
        confirmAccountNumber: '999999999999', // Mismatch!
        ifscCode: 'SBIN0000358',
      },
    };

    expect(() => damohDeliveryPartnerOnboardingSchema.parse(mismatchBankPayload)).toThrow(
      /Bank account numbers do not match/
    );
  });

  it('rejects invalid DL format for Bike or EV', () => {
    const invalidDlPayload = {
      fullName: 'Vikram Singh',
      phone: '8765432109',
      emergencyPhone: '9876543212',
      dob: '1995-10-20',
      vehicleType: 'BIKE' as const,
      dlNumber: 'INVALID_DL',
      rcNumber: 'MP15AB1234',
      panNumber: 'FGHIJ5678K',
      aadharNumber: '987654321098',
      bankDetails: {
        accountHolderName: 'Vikram Singh',
        bankName: 'HDFC Bank Ltd',
        branchName: 'Damoh Branch',
        accountNumber: '987654321098',
        confirmAccountNumber: '987654321098',
        ifscCode: 'HDFC0001234',
      },
    };

    expect(() => damohDeliveryPartnerOnboardingSchema.parse(invalidDlPayload)).toThrow(
      /Parivahan format/
    );
  });

  it('rejects applicants under 18 years of age', () => {
    const underagePayload = {
      fullName: 'Minor Applicant',
      phone: '8765432109',
      emergencyPhone: '9876543212',
      dob: '2015-10-20', // ~11 years old
      vehicleType: 'CYCLE' as const,
      panNumber: 'FGHIJ5678K',
      aadharNumber: '987654321098',
      bankDetails: {
        accountHolderName: 'Minor Applicant',
        bankName: 'HDFC Bank Ltd',
        branchName: 'Damoh Branch',
        accountNumber: '987654321098',
        confirmAccountNumber: '987654321098',
        ifscCode: 'HDFC0001234',
      },
    };

    expect(() => damohDeliveryPartnerOnboardingSchema.parse(underagePayload)).toThrow(
      /at least 18 years old/
    );
  });
});
