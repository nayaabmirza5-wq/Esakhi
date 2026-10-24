import { z } from 'zod';

const addressSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().regex(/^\+91[6-9]\d{9}$/),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).optional(),
  locality: z.string().trim().min(1).max(100),
  postalCode: z.string().regex(/^\d{6}$/),
}).strict();

const orderItemSchema = z.object({
  productId: z.string().regex(/^[a-f\d]{24}$/i),
  variantId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  quantity: z.number().int().min(1).max(99),
}).strict();

export const createOrderSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
  customerName: z.string().trim().min(1).max(120),
  customerPhone: z.string().trim().regex(/^\+91[6-9]\d{9}$/),
  fulfilmentMethod: z.enum(['delivery', 'pickup']),
  address: addressSchema.optional(),
  items: z.array(orderItemSchema).min(1).max(30),
  paymentMethod: z.enum(['upi', 'cash']),
}).strict().superRefine((order, context) => {
  if (order.fulfilmentMethod === 'delivery' && !order.address) {
    context.addIssue({ code: 'custom', path: ['address'], message: 'A delivery address is required.' });
  }
  if (order.address && order.address.phone !== order.customerPhone) {
    context.addIssue({ code: 'custom', path: ['address', 'phone'], message: 'The delivery phone must match the order contact.' });
  }
  const uniqueLines = new Set(order.items.map((item) => `${item.productId}:${item.variantId ?? 'base'}`));
  if (uniqueLines.size !== order.items.length) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Each product or variant can appear only once.' });
  }
});

export const orderIdParamsSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) });
export const cancellationRequestSchema = z.object({ note: z.string().trim().max(500).optional() }).strict();
export const cancellationReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).optional(),
}).strict();
export const paymentReviewSchema = z.object({
  status: z.enum(['confirmed', 'rejected']),
  note: z.string().trim().min(1).max(1000),
}).strict();
export const fulfilmentUpdateSchema = z.object({
  status: z.enum(['accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'completed', 'delivery_failed']),
  note: z.string().trim().max(500).optional(),
}).strict();
export const deliveryPartnerSchema = z.object({
  partnerId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().regex(/^(\+91)?[6-9]\d{9}$/),
  internalNotes: z.string().trim().max(500).optional(),
}).strict();
export const internalNoteSchema = z.object({
  note: z.string().trim().min(1).max(1000),
}).strict();
export const orderPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const orderListQuerySchema = orderPaginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  paymentStatus: z.enum(['pending_verification', 'confirmed', 'rejected']).optional(),
  fulfilmentStatus: z.enum(['placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'completed', 'cancelled', 'delivery_failed']).optional(),
  cancellationRequest: z.enum(['pending', 'reviewed']).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((query, context) => {
  if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
    context.addIssue({ code: 'custom', path: ['from'], message: '`from` must be earlier than or equal to `to`.' });
  }
});
