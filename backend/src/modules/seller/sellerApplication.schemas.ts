import { z } from 'zod';
import { categoryMaster } from '../catalog/categoryMaster.js';

function isValidSubcategory(categoryId: string, subcategoryId: string): boolean {
  return categoryMaster.some((category) =>
    category.categoryId === categoryId
    && category.subcategories.some((subcategory) => subcategory.subcategoryId === subcategoryId));
}

const phoneSchema = z.string().trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .transform((value) => value.startsWith('+') ? value : `+91${value}`)
  .refine((value) => /^\+91[6-9]\d{9}$/.test(value), 'Enter a valid 10-digit Indian mobile number.');

export const createSellerApplicationSchema = z.object({
  shgName: z.string().trim().min(2).max(160),
  representative: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  city: z.string().trim().min(2).max(100),
  address: z.string().trim().min(5).max(500),
  categoryId: z.string(),
  subcategoryId: z.string(),
  productType: z.string().trim().min(1).max(160),
  fssaiRegistrationNumber: z.string().trim().regex(/^\d{14}$/, 'Enter the 14-digit FSSAI registration or licence number.').optional(),
}).strict().superRefine((input, context) => {
  if (!isValidSubcategory(input.categoryId, input.subcategoryId)) {
    context.addIssue({ code: 'custom', path: ['subcategoryId'], message: 'Choose a subcategory within the selected category.' });
  }
  if (input.categoryId === 'food-items' && !input.fssaiRegistrationNumber) {
    context.addIssue({ code: 'custom', path: ['fssaiRegistrationNumber'], message: 'FSSAI registration or licence details are required for food sellers.' });
  }
  if (input.categoryId !== 'food-items' && input.fssaiRegistrationNumber) {
    context.addIssue({ code: 'custom', path: ['fssaiRegistrationNumber'], message: 'FSSAI details are only collected for food sellers.' });
  }
});

export const sellerApplicationPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'approved', 'rejected', 'needs_info']).optional(),
}).strict();

export const sellerApplicationReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'needs_info']),
  note: z.string().trim().max(1000).optional(),
  fssaiDecision: z.enum(['verified', 'needs_info']).optional(),
}).strict().superRefine((input, context) => {
  if (input.decision === 'rejected' && !input.note) {
    context.addIssue({ code: 'custom', path: ['note'], message: 'A rejection reason is required.' });
  }
  if (input.decision !== 'approved' && input.fssaiDecision === 'verified') {
    context.addIssue({ code: 'custom', path: ['fssaiDecision'], message: 'FSSAI verification can only be recorded while approving the seller.' });
  }
});