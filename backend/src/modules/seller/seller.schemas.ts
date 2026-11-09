import { z } from 'zod';

export const sellerOnboardingSchema = z.object({
  phone: z.string().trim().optional(),
  taxDetails: z.object({
    hasGst: z.boolean().default(false),
    gstin: z.string().trim().toUpperCase().optional().or(z.literal('')),
    hasEnrolmentId: z.boolean().default(false),
    enrolmentId: z.string().trim().toUpperCase().optional().or(z.literal('')),
    panNumber: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Enter a valid 10-character PAN.'),
    businessName: z.string().trim().min(2).max(200),
    email: z.string().trim().email(),
  }),
  pickupAddress: z.object({
    streetAddress: z.string().trim().min(3).max(300),
    locality: z.string().trim().max(150).optional().default(''),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(100),
    pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a valid 6-digit PIN code.'),
    landmark: z.string().trim().max(150).optional().default(''),
  }),
  bankDetails: z.object({
    accountHolderName: z.string().trim().min(2).max(150),
    bankName: z.string().trim().max(150).optional().default(''),
    accountNumber: z.string().trim().regex(/^\d{9,18}$/, 'Bank account number must be between 9 and 18 digits.'),
    ifscCode: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid 11-character IFSC code.'),
    accountType: z.enum(['SAVINGS', 'CURRENT']).default('SAVINGS'),
  }),
  supplierDetails: z.object({
    shgCode: z.string().trim().toUpperCase().optional().or(z.literal('')),
    shgName: z.string().trim().min(2).max(200),
    shgLeaderName: z.string().trim().min(2).max(150),
    numberOfMembers: z.coerce.number().int().min(1).default(10),
    category: z.enum(['HANDICRAFT', 'TEXTILES', 'FOOD', 'HERBAL']),
    isFoodSeller: z.boolean().default(false),
    fssaiNumber: z.string().trim().optional().or(z.literal('')),
    district: z.string().trim().min(2).max(100),
  }),
}).superRefine((data, ctx) => {
  if (data.supplierDetails.isFoodSeller || data.supplierDetails.category === 'FOOD') {
    if (!data.supplierDetails.fssaiNumber || !/^\d{14}$/.test(data.supplierDetails.fssaiNumber.trim())) {
      ctx.addIssue({
        code: 'custom',
        path: ['supplierDetails', 'fssaiNumber'],
        message: 'Food sellers must provide a valid 14-digit numeric FSSAI registration number.',
      });
    }
  }
});

export type SellerOnboardingInput = z.infer<typeof sellerOnboardingSchema>;

export const sellerProfileUpdateSchema = z.object({
  shgName: z.string().trim().min(2).max(160),
  representative: z.string().trim().min(2).max(120),
  registeredAddress: z.string().trim().min(5).max(500),
  storeDescription: z.string().trim().max(1000).default(''),
}).strict();

export const sellerInventoryHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const sellerOrderParamsSchema = z.object({
  orderId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid order ID.'),
}).strict();

export const sellerOrderStatusUpdateSchema = z.object({
  status: z.enum(['accepted', 'preparing', 'ready_for_pickup', 'completed']),
  note: z.string().trim().max(500).optional(),
  inspectionImageUrls: z.array(z.string().trim().min(1)).length(5).optional(),
  inspectionNote: z.string().trim().max(500).optional(),
}).strict();

export const sellerInspectionImagesUploadSchema = z.object({
  imageUrls: z.array(z.string().trim().min(1)).length(5, 'Exactly 5 pre-dispatch inspection images are required.'),
  inspectionNote: z.string().trim().max(500).optional(),
}).strict();
