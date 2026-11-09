import { z } from 'zod';

const normalizedPhoneSchema = z.string().trim().transform((value) => {
  const compact = value.replace(/[\s()-]/g, '');
  if (/^[6-9]\d{9}$/.test(compact)) return `+91${compact}`;
  if (/^\+91[6-9]\d{9}$/.test(compact)) return compact;
  return compact;
}).pipe(z.string().regex(/^\+91[6-9]\d{9}$/, 'Enter a valid Indian mobile number.'));

export const requestOtpSchema = z.object({
  phone: normalizedPhoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: normalizedPhoneSchema,
  otp: z.string().optional(),
  code: z.string().optional(),
}).refine((data) => Boolean((data.otp && /^\d{6}$/.test(data.otp)) || (data.code && /^\d{6}$/.test(data.code))), {
  message: 'OTP must contain six digits.',
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email("Enter a valid email address.").optional().or(z.literal("")),
}).strict();

export const savedAddressSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  label: z.string().trim().min(1).max(40).default('Home'),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().regex(/^\+91[6-9]\d{9}$/),
  addressLine1: z.string().trim().max(200).default(''),
  addressLine2: z.string().trim().max(200).optional(),
  locality: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  postalCode: z.string().regex(/^\d{6}$/),
  houseNumber: z.string().trim().max(100).optional(),
  street: z.string().trim().max(150).optional(),
  area: z.string().trim().max(100).optional(),
  landmark: z.string().trim().max(150).optional(),
  villageOrCity: z.string().trim().max(100).optional(),
  district: z.string().trim().max(100).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  locationAccuracyMeters: z.number().min(0).max(100_000).optional(),
  formattedAddress: z.string().trim().max(700).optional(),
  deliveryInstructions: z.string().trim().max(500).optional(),
  isDefault: z.boolean().default(false),
}).strict();

export const addressIdParamsSchema = z.object({
  addressId: z.string().regex(/^[a-f\d]{24}$/i),
}).strict();

export const addressSearchQuerySchema = z.object({
  q: z.string().trim().min(3).max(120),
}).strict();

export const addressReverseQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
}).strict();

export const replaceSavedAddressesSchema = z.object({
  addresses: z.array(savedAddressSchema).max(10),
}).strict();

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
