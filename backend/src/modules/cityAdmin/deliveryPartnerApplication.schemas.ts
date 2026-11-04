import { z } from 'zod';

const phoneSchema = z.string().trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .transform((value) => (value.startsWith('+') ? value : `+91${value}`))
  .refine((value) => /^\+91[6-9]\d{9}$/.test(value), 'Enter a valid 10-digit Indian mobile number.');

const baseRiderApplicationFields = {
  name: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  city: z.string().trim().min(2).max(100),
  requestedLocalities: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
  applicantNote: z.string().trim().max(1000).optional(),

  // Personal Biodata
  selfieUrl: z.string().trim().optional(),
  emergencyContactName: z.string().trim().max(120).optional(),
  emergencyContactRel: z.string().trim().max(50).optional(),
  emergencyContactPhone: z.string().trim().max(16).optional(),
  residentialAddress: z.string().trim().max(300).optional(),
  pincode: z.string().trim().max(6).optional(),

  // Banking (Double-entry validation)
  accountNumber: z.string().trim().optional(),
  confirmAccountNumber: z.string().trim().optional(),
  ifscCode: z.string().trim().max(11).optional(),
  bankName: z.string().trim().max(150).optional(),
  branchName: z.string().trim().max(150).optional(),
  upiVpa: z.string().trim().max(100).optional(),
  passbookDocUrl: z.string().trim().optional(),
};

const bicycleRiderSchema = z.object({
  ...baseRiderApplicationFields,
  vehicleType: z.literal('BICYCLE').default('BICYCLE'),
  // No-DL rule: driving license is waived; a government ID is captured instead.
  govIdUrl: z.string().trim().optional(),
  serviceRadiusKm: z.coerce.number().positive().max(50).default(3.0),
  dlNumber: z.string().trim().optional(),
  dlExpiryDate: z.string().optional(),
  vehicleRcNumber: z.string().trim().optional(),
  dlFrontUrl: z.string().trim().optional(),
  dlBackUrl: z.string().trim().optional(),
});

const motorcycleRiderSchema = z.object({
  ...baseRiderApplicationFields,
  vehicleType: z.literal('MOTORCYCLE'),
  dlNumber: z.string().trim().min(8, 'DL Number is mandatory for two-wheelers'),
  dlExpiryDate: z.string().min(1, 'DL Expiry Date is mandatory'),
  vehicleRcNumber: z.string().trim().min(6, 'Vehicle RC is mandatory for two-wheelers'),
  dlFrontUrl: z.string().trim().min(1, 'DL Front image is mandatory'),
  dlBackUrl: z.string().trim().min(1, 'DL Back image is mandatory'),
  govIdUrl: z.string().trim().optional(),
  serviceRadiusKm: z.coerce.number().positive().max(50).optional(),
});

export const createDeliveryPartnerApplicationSchema = z.discriminatedUnion('vehicleType', [
  bicycleRiderSchema,
  motorcycleRiderSchema,
]).superRefine((input, context) => {
  if (new Set(input.requestedLocalities.map((locality) => locality.toLocaleLowerCase())).size !== input.requestedLocalities.length) {
    context.addIssue({ code: 'custom', path: ['requestedLocalities'], message: 'A locality can only be selected once.' });
  }
  if (input.accountNumber && input.confirmAccountNumber && input.accountNumber !== input.confirmAccountNumber) {
    context.addIssue({ code: 'custom', path: ['confirmAccountNumber'], message: 'Bank account numbers do not match.' });
  }
});

export const deliveryPartnerApplicationListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'approved', 'rejected', 'needs_info', 'action_required']).optional(),
}).strict();

export const reviewDeliveryPartnerApplicationSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'needs_info', 'action_required']),
  note: z.string().trim().max(1000).optional(),
  flaggedFields: z.array(z.string().trim()).default([]),
}).strict().superRefine((input, context) => {
  if ((input.decision === 'rejected' || input.decision === 'action_required') && !input.note) {
    context.addIssue({ code: 'custom', path: ['note'], message: 'A review or rejection reason is required.' });
  }
});
