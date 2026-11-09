import { beforeAll, describe, expect, it } from 'vitest';
import { sellerOnboardingSchema } from '../src/modules/seller/seller.schemas.js';
import { Seller } from '../src/models/Seller.js';
import { User } from '../src/models/User.js';

let DAMOH_SHG_DATABASE: any;
let verifyEnrolmentIdHandler: any;
let verifyGstinHandler: any;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/esakhi-test?replicaSet=rs0';
  process.env.CLIENT_ORIGINS = 'http://localhost:5173';
  process.env.JWT_ACCESS_SECRET = 'a'.repeat(128);
  process.env.JWT_REFRESH_SECRET = 'b'.repeat(128);
  process.env.OTP_PROVIDER = 'development';
  process.env.DEV_OTP_CODE = '246810';

  const sellerController = await import('../src/modules/seller/seller.controller.js');
  DAMOH_SHG_DATABASE = sellerController.DAMOH_SHG_DATABASE;
  verifyEnrolmentIdHandler = sellerController.verifyEnrolmentIdHandler;
  verifyGstinHandler = sellerController.verifyGstinHandler;
});

describe('Seller Onboarding & Auto-Activation Schema', () => {
  it('exports the Seller and User models properly', () => {
    expect(Seller).toBeDefined();
    expect(Seller.modelName).toBe('Seller');
    expect(User).toBeDefined();
    expect(User.modelName).toBe('User');
  });

  it('validates a complete 4-step seller onboarding payload with SHG code', () => {
    const validPayload = {
      phone: '+919876543210',
      taxDetails: {
        hasGst: false,
        hasEnrolmentId: false,
        panNumber: 'ABCDE1234F',
        businessName: 'Maitri Swasahayata Samooh',
        email: 'maitri.shg@example.com',
      },
      pickupAddress: {
        streetAddress: 'Civil Ward No. 4, Old Station Road',
        locality: 'Station Ward',
        city: 'Damoh',
        state: 'Madhya Pradesh',
        pincode: '470661',
        landmark: 'Opposite Panchayat Bhawan',
      },
      bankDetails: {
        accountHolderName: 'Maitri Mahila Samooh',
        bankName: 'State Bank of India',
        accountNumber: '123456789012',
        ifscCode: 'SBIN0000358',
        accountType: 'SAVINGS' as const,
      },
      supplierDetails: {
        shgCode: 'MP-DMH-1042',
        shgName: 'Maitri Mahila Swayam Sahayata Samooh',
        shgLeaderName: 'Radha Bai',
        numberOfMembers: 12,
        category: 'HANDICRAFT' as const,
        isFoodSeller: false,
        district: 'Damoh',
      },
    };

    const parsed = sellerOnboardingSchema.parse(validPayload);
    expect(parsed.supplierDetails.shgName).toBe('Maitri Mahila Swayam Sahayata Samooh');
    expect(parsed.supplierDetails.shgCode).toBe('MP-DMH-1042');
    expect(parsed.bankDetails.ifscCode).toBe('SBIN0000358');
    expect(parsed.taxDetails.panNumber).toBe('ABCDE1234F');
    expect(parsed.pickupAddress.city).toBe('Damoh');
  });

  it('validates a food seller with 14-digit FSSAI registration number', () => {
    const foodPayload = {
      phone: '+919876543211',
      taxDetails: {
        hasGst: true,
        gstin: '23AAAAA0000A1Z5',
        hasEnrolmentId: false,
        panNumber: 'FGHIJ5678K',
        businessName: 'Annapurna Spices & Pickles SHG',
        email: 'annapurna.food@example.com',
      },
      pickupAddress: {
        streetAddress: 'Gandhi Chowk, Near Market',
        city: 'Damoh',
        state: 'Madhya Pradesh',
        pincode: '470661',
      },
      bankDetails: {
        accountHolderName: 'Annapurna Mahila Samooh',
        accountNumber: '987654321098',
        ifscCode: 'HDFC0001234',
        accountType: 'CURRENT' as const,
      },
      supplierDetails: {
        shgCode: 'MP-DMH-2088',
        shgName: 'Annapurna Mahila SHG',
        shgLeaderName: 'Sunita Sharma',
        numberOfMembers: 15,
        category: 'FOOD' as const,
        isFoodSeller: true,
        fssaiNumber: '21421850000123',
        district: 'Damoh',
      },
    };

    const parsed = sellerOnboardingSchema.parse(foodPayload);
    expect(parsed.supplierDetails.category).toBe('FOOD');
    expect(parsed.supplierDetails.isFoodSeller).toBe(true);
    expect(parsed.supplierDetails.fssaiNumber).toBe('21421850000123');
    expect(parsed.taxDetails.gstin).toBe('23AAAAA0000A1Z5');
  });

  it('contains pre-seeded Damoh SHG master records for auto-fill', () => {
    expect(DAMOH_SHG_DATABASE['MP-DMH-1042']).toBeDefined();
    expect(DAMOH_SHG_DATABASE['MP-DMH-1042']?.shgName).toBe('Maitri Mahila Swayam Sahayata Samooh');
    expect(DAMOH_SHG_DATABASE['MP-DMH-1042']?.category).toBe('HANDICRAFT');

    expect(DAMOH_SHG_DATABASE['MP-DMH-2088']).toBeDefined();
    expect(DAMOH_SHG_DATABASE['MP-DMH-2088']?.category).toBe('FOOD');

    expect(DAMOH_SHG_DATABASE['MP-DMH-3015']).toBeDefined();
    expect(DAMOH_SHG_DATABASE['MP-DMH-3015']?.category).toBe('TEXTILES');
  });

  it('rejects food sellers missing a valid 14-digit FSSAI number', () => {
    const invalidFoodPayload = {
      phone: '+919876543211',
      taxDetails: {
        hasGst: false,
        hasEnrolmentId: false,
        panNumber: 'FGHIJ5678K',
        businessName: 'Annapurna Food',
        email: 'annapurna@example.com',
      },
      pickupAddress: {
        streetAddress: 'Gandhi Chowk',
        city: 'Damoh',
        state: 'MP',
        pincode: '470661',
      },
      bankDetails: {
        accountHolderName: 'Annapurna',
        accountNumber: '987654321098',
        ifscCode: 'HDFC0001234',
      },
      supplierDetails: {
        shgName: 'Annapurna SHG',
        shgLeaderName: 'Leader',
        numberOfMembers: 10,
        category: 'FOOD' as const,
        isFoodSeller: true,
        fssaiNumber: '12345', // Invalid: not 14 digits
        district: 'Damoh',
      },
    };

    expect(() => sellerOnboardingSchema.parse(invalidFoodPayload)).toThrow(
      /14-digit numeric FSSAI/
    );
  });

  it('rejects account numbers outside 9-18 digits range', () => {
    const invalidAccountPayload = {
      taxDetails: {
        hasGst: false,
        hasEnrolmentId: false,
        panNumber: 'FGHIJ5678K',
        businessName: 'Test SHG',
        email: 'test@example.com',
      },
      pickupAddress: {
        streetAddress: 'Street',
        city: 'Damoh',
        state: 'MP',
        pincode: '470661',
      },
      bankDetails: {
        accountHolderName: 'Test',
        accountNumber: '12345678', // Only 8 digits!
        ifscCode: 'SBIN0000358',
      },
      supplierDetails: {
        shgName: 'Test SHG',
        shgLeaderName: 'Leader',
        numberOfMembers: 10,
        category: 'HANDICRAFT' as const,
        district: 'Damoh',
      },
    };

    expect(() => sellerOnboardingSchema.parse(invalidAccountPayload)).toThrow(
      /between 9 and 18 digits/
    );
  });

  it('rejects invalid PAN or invalid IFSC formats', () => {
    const invalidPayload = {
      taxDetails: {
        hasGst: false,
        hasEnrolmentId: false,
        panNumber: 'INVALID', // Not 10 chars
        businessName: 'Test',
        email: 'invalid-email',
      },
      pickupAddress: {
        streetAddress: 'Street',
        city: 'Damoh',
        state: 'MP',
        pincode: '123', // Not 6 digits
      },
      bankDetails: {
        accountHolderName: 'Test Holder',
        accountNumber: '123',
        ifscCode: 'INVALID',
      },
      supplierDetails: {
        shgName: 'Test SHG',
        shgLeaderName: 'Leader',
        numberOfMembers: 0,
        category: 'HANDICRAFT',
        district: 'Damoh',
      },
    };

    expect(() => sellerOnboardingSchema.parse(invalidPayload)).toThrow();
  });

  it('validates small SHG with generated 16-character GST Enrolment ID under Notification 34/2023', () => {
    const pan = 'ABCDE1234F';
    const sumDigits = pan.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const checksumChar = String.fromCharCode(65 + (sumDigits % 26));
    const checksumNum = sumDigits % 10;
    const generatedEnrolmentId = (`23${pan}U1${checksumChar}${checksumNum}`).slice(0, 16);

    expect(generatedEnrolmentId).toHaveLength(16);
    expect(generatedEnrolmentId.startsWith('23')).toBe(true);
    expect(generatedEnrolmentId).toContain(pan);
    expect(generatedEnrolmentId).toContain('U1');

    const exemptShgPayload = {
      phone: '+919876543299',
      taxDetails: {
        hasGst: false,
        hasEnrolmentId: true,
        enrolmentId: generatedEnrolmentId,
        panNumber: pan,
        businessName: 'Maitri Samooh Seller',
        email: 'maitri.exempt@example.com',
      },
      pickupAddress: {
        streetAddress: 'Gram Panchayat Nohta',
        city: 'Damoh',
        state: 'Madhya Pradesh',
        pincode: '470661',
      },
      bankDetails: {
        accountHolderName: 'Maitri Mahila Samooh',
        accountNumber: '123456789012',
        ifscCode: 'SBIN0000358',
        accountType: 'SAVINGS' as const,
      },
      supplierDetails: {
        shgCode: 'MP-DMH-1042',
        shgName: 'Maitri Mahila Swayam Sahayata Samooh',
        shgLeaderName: 'Anita Raikwar',
        numberOfMembers: 12,
        category: 'HANDICRAFT' as const,
        district: 'Damoh',
      },
    };

    const parsed = sellerOnboardingSchema.parse(exemptShgPayload);
    expect(parsed.taxDetails.hasEnrolmentId).toBe(true);
    expect(parsed.taxDetails.enrolmentId).toBe(generatedEnrolmentId);
    expect(parsed.taxDetails.hasGst).toBe(false);
  });

  it('verifies 15-character and 16-character Enrolment IDs displaying official fields', async () => {
    const createMockRes = () => {
      const res: any = {
        statusCode: 200,
        status(code: number) {
          res.statusCode = code;
          return res;
        },
        json(data: any) {
          res.data = data;
          return res;
        },
      };
      return res;
    };

    const pan = 'KKQPM7552B';
    const enr16 = '23KKQPM7552BU1R7';
    const req16 = { body: { enrolmentId: enr16, panNumber: pan } } as any;
    const res16 = createMockRes();
    await verifyEnrolmentIdHandler(req16, res16, () => {});
    expect(res16.data.data.isValid).toBe(true);
    expect(res16.data.data.status).toBe('Active');
    expect(res16.data.data.legalNameOfBusiness).toBe('NAYAAB MIRZA');
    expect(res16.data.data.tradeName).toBeDefined();
    expect(res16.data.data.effectiveDateOfCreation).toBeDefined();
    expect(res16.data.data.stateJurisdiction).toContain('Madhya Pradesh');

    // 15-character Temporary ID
    const enr15 = '23KKQPM7552BU1R';
    const req15 = { body: { enrolmentId: enr15, panNumber: pan } } as any;
    const res15 = createMockRes();
    await verifyEnrolmentIdHandler(req15, res15, () => {});
    expect(res15.data.data.isValid).toBe(true);
    expect(res15.data.data.status).toBe('Active');
    expect(res15.data.data.legalNameOfBusiness).toBe('NAYAAB MIRZA');
  });

  it('returns "No records found for the entered Temporary ID" for invalid/fake Temporary ID', async () => {
    const createMockRes = () => {
      const res: any = { statusCode: 200, status(code: number) { res.statusCode = code; return res; }, json(data: any) { res.data = data; return res; } };
      return res;
    };
    const reqFake = { body: { enrolmentId: 'FAKE12345678901' } } as any;
    const resFake = createMockRes();
    await expect(verifyEnrolmentIdHandler(reqFake, resFake, () => {})).rejects.toThrow('No records found for the entered Temporary ID');
  });

  it('verifies 15-character GSTIN with official business records', async () => {
    const createMockRes = () => {
      const res: any = { statusCode: 200, status(code: number) { res.statusCode = code; return res; }, json(data: any) { res.data = data; return res; } };
      return res;
    };
    const validGstin = '23KKQPM7552B1Z5';
    const req = { body: { gstin: validGstin, panNumber: 'KKQPM7552B' } } as any;
    const res = createMockRes();
    await verifyGstinHandler(req, res, () => {});
    expect(res.data.data.isValid).toBe(true);
    expect(res.data.data.status).toBe('Active');
    expect(res.data.data.legalNameOfBusiness).toBe('NAYAAB MIRZA');
    expect(res.data.data.tradeName).toContain('NAYAAB MIRZA');
    expect(res.data.data.stateJurisdiction).toContain('Madhya Pradesh');
  });

  it('rejects GSTIN when embedded PAN does not match user PAN', async () => {
    const createMockRes = () => {
      const res: any = { statusCode: 200, status(code: number) { res.statusCode = code; return res; }, json(data: any) { res.data = data; return res; } };
      return res;
    };
    const validGstin = '23KKQPM7552B1Z5';
    const req = { body: { gstin: validGstin, panNumber: 'ABCDE1234F' } } as any;
    const res = createMockRes();
    await expect(verifyGstinHandler(req, res, () => {})).rejects.toThrow(/does not match/);
  });
});
