import { z } from 'zod';

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
