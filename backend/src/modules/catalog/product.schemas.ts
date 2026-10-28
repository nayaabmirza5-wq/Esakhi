import { z } from 'zod';

const categorySchema = z.enum(['Bangles', 'Jewellery', 'Dupattas', 'Others']);
const imageUrlSchema = z.string().refine(
  (value) => isHttpsUrl(value) || isUploadedProductImage(value),
  'Use an HTTPS image URL or upload an image through the admin workspace.',
);
const mapKeySchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/, 'Use letters, numbers, underscores, or hyphens for keys.');

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isUploadedProductImage(value: string): boolean {
  return /^\/uploads\/product-images\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(value);
}

const variantInputSchema = z.object({
  sku: z.string().trim().max(80).optional(),
  attributes: z.record(mapKeySchema, z.string().trim().min(1).max(80)).default({}),
  stock: z.number().int().min(0).default(0),
});

export const productCreateSchema = z.object({
  sellerId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180),
  description: z.string().trim().min(1).max(5000),
  category: categorySchema,
  pricePaise: z.number().int().min(1).max(100_000_000),
  imageUrls: z.array(imageUrlSchema).max(10).default([]),
  stock: z.number().int().min(0).default(0),
  lowStockThreshold: z.number().int().min(0).max(100_000).default(5),
  variants: z.array(variantInputSchema).max(50).default([]),
  isActive: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.variants.length > 0 && value.stock !== 0) {
    context.addIssue({ code: 'custom', path: ['stock'], message: 'Use variant stock when variants are configured.' });
  }
});

export const productUpdateSchema = z.object({
  sellerId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  category: categorySchema.optional(),
  pricePaise: z.number().int().min(1).max(100_000_000).optional(),
  imageUrls: z.array(imageUrlSchema).max(10).optional(),
  lowStockThreshold: z.number().int().min(0).max(100_000).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  category: categorySchema.optional(),
  q: z.string().trim().max(100).optional(),
}).strict();

export const bestSellerQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(5),
}).strict();

export const slugParamsSchema = z.object({ slug: z.string().min(1).max(180) });
export const idParamsSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) });
