import { z } from 'zod';
import {
  ADMIN_RESOLUTION_ACTIONS,
  DELIVERY_EXCEPTION_REASON_CODES,
  DELIVERY_STATUS_ENUM,
  FULFILMENT_STATUS_ENUM,
  RETURN_FAULT_ATTRIBUTIONS,
  RETURN_REASON_CODES,
  RIDER_REQUESTED_ACTIONS,
} from './order.model.js';

const addressSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().regex(/^\+91[6-9]\d{9}$/),
  addressLine1: z.string().trim().max(200).default(''),
  addressLine2: z.string().trim().max(200).nullish().transform((value) => value ?? undefined),
  locality: z.string().trim().min(1).max(100),
  postalCode: z.string().regex(/^\d{6}$/),
  houseNumber: z.string().trim().max(100).nullish().transform((value) => value ?? undefined),
  street: z.string().trim().max(150).nullish().transform((value) => value ?? undefined),
  area: z.string().trim().max(100).nullish().transform((value) => value ?? undefined),
  landmark: z.string().trim().max(150).nullish().transform((value) => value ?? undefined),
  villageOrCity: z.string().trim().max(100).nullish().transform((value) => value ?? undefined),
  district: z.string().trim().max(100).nullish().transform((value) => value ?? undefined),
  city: z.string().trim().min(1).max(100).nullish().transform((value) => value ?? undefined),
  state: z.string().trim().min(1).max(100).nullish().transform((value) => value ?? undefined),
  latitude: z.number().min(-90).max(90).nullish().transform((value) => value ?? undefined),
  longitude: z.number().min(-180).max(180).nullish().transform((value) => value ?? undefined),
  locationAccuracyMeters: z.number().min(0).max(100_000).nullish().transform((value) => value ?? undefined),
  deliveryInstructions: z.string().trim().max(500).nullish().transform((value) => value ?? undefined),
}).strict();

const orderItemSchema = z.object({
  productId: z.string().regex(/^[a-f\d]{24}$/i),
  sellerId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  variantId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  quantity: z.number().int().min(1).max(99),
}).strict();

export const createOrderSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
  customerName: z.string().trim().min(1).max(120),
  customerPhone: z.string().trim().regex(/^\+91[6-9]\d{9}$/),
  fulfilmentMethod: z.enum(['delivery', 'pickup']),
  address: addressSchema.optional(),
  deliveryInstructions: z.string().trim().max(500).optional(),
  items: z.array(orderItemSchema).min(1).max(30),
  paymentMethod: z.enum(['upi', 'cash']),
}).strict().superRefine((order, context) => {
  if (order.fulfilmentMethod === 'delivery' && !order.address) {
    context.addIssue({ code: 'custom', path: ['address'], message: 'A delivery address is required.' });
  }
  if (order.address && !order.address.addressLine1 && !order.address.houseNumber && !order.address.street && !order.address.area) {
    context.addIssue({ code: 'custom', path: ['address', 'addressLine1'], message: 'Enter a house, street, or area for the delivery address.' });
  }
  if (order.address && ((order.address.latitude === undefined) !== (order.address.longitude === undefined))) {
    context.addIssue({ code: 'custom', path: ['address', 'latitude'], message: 'Both latitude and longitude are required for a map pin.' });
  }
  if (order.address?.locationAccuracyMeters !== undefined && order.address.latitude === undefined) {
    context.addIssue({ code: 'custom', path: ['address', 'locationAccuracyMeters'], message: 'GPS accuracy requires a confirmed map pin.' });
  }
  if (order.deliveryInstructions && order.fulfilmentMethod !== 'delivery') {
    context.addIssue({ code: 'custom', path: ['deliveryInstructions'], message: 'Delivery instructions are only available for delivery orders.' });
  }
  const uniqueLines = new Set(order.items.map((item) => `${item.productId}:${item.variantId ?? 'base'}`));
  if (uniqueLines.size !== order.items.length) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Each product or variant can appear only once.' });
  }
});

export const orderIdParamsSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) });
export const cancellationRequestSchema = z.object({ note: z.string().trim().max(500).optional() }).strict();
export const directCancelOrderSchema = z.object({
  reason: z.string().trim().min(2).max(500).optional(),
}).strict();
export const customerBankAccountSchema = z.object({
  accountHolderName: z.string().trim().min(2).max(120),
  accountNumber: z.string().trim().min(6).max(32),
  ifscCode: z.string().trim().min(4).max(20),
  bankName: z.string().trim().min(2).max(120),
  upiId: z.string().trim().max(120).optional(),
}).strict();
export const returnRequestInputSchema = z.object({
  reasonCode: z.enum(RETURN_REASON_CODES),
  reasonText: z.string().trim().min(3).max(800),
  boxConditionImages: z.array(z.string().trim().min(1)).min(1, 'Upload at least 1 outer box condition image').max(6),
  productFaultImages: z.array(z.string().trim().min(1)).min(1, 'Upload at least 1 product fault/discrepancy image').max(6),
}).strict();
export const sellerPreDispatchInspectionSchema = z.object({
  imageUrls: z.array(z.string().trim().min(1)).length(5, 'Exactly 5 pre-dispatch inspection images are required'),
  inspectionNote: z.string().trim().max(500).optional(),
}).strict();
export const cityAdminReturnArbitrationSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  faultAttribution: z.enum(RETURN_FAULT_ATTRIBUTIONS).optional(),
  penaltyAmountRupees: z.number().min(0).max(100000).optional(),
  reviewNote: z.string().trim().min(3).max(600),
}).strict();
export const reportDeliveryFailureSchema = z.object({
  reasonCode: z.enum(DELIVERY_EXCEPTION_REASON_CODES),
  reasonNotes: z.string().trim().max(1000).optional().default(''),
  proofImageUrl: z.string().trim().nullish().transform((v) => v ?? null),
  riderRequestedAction: z.enum(RIDER_REQUESTED_ACTIONS).optional().default('UNASSIGN_ME'),
}).strict();

export const cityAdminResolveDeliveryFailureSchema = z.object({
  action: z.enum(ADMIN_RESOLUTION_ACTIONS),
  newRiderId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  partnerId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  adminNotes: z.string().trim().max(1000).optional().default(''),
}).strict().superRefine((data, ctx) => {
  if (data.action === 'REASSIGN_NEW_RIDER' && !data.newRiderId && !data.partnerId) {
    ctx.addIssue({
      code: 'custom',
      path: ['newRiderId'],
      message: 'A new delivery partner is required when choosing REASSIGN_NEW_RIDER.',
    });
  }
});

export const reverseOrderPartnerStatusSchema = z.object({
  status: z.enum(['return_picked_up', 'return_delivered_to_seller']),
  note: z.string().trim().max(500).optional(),
}).strict();
export const cancellationReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).optional(),
}).strict();
export const paymentReviewSchema = z.object({
  status: z.enum(['confirmed', 'rejected']),
  note: z.string().trim().min(1).max(1000),
}).strict();
export const fulfilmentUpdateSchema = z.object({
  status: z.enum([
    'order_confirmed',
    'accepted',
    'preparing',
    'ready_for_pickup',
    'delivery_partner_assigned',
    'out_for_pickup',
    'picked_up',
    'out_for_delivery',
    'delivered',
    'completed',
    'delivery_failed',
  ]),
  note: z.string().trim().max(500).optional(),
  paymentCollected: z.boolean().optional(),
}).strict();
export const partnerAvailabilitySchema = z.object({
  isOnline: z.boolean().optional(),
  availabilityStatus: z.enum(['available', 'busy', 'offline']).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
}).strict();
export const deliveryPartnerSchema = z.object({
  partnerId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().regex(/^(\+91)?[6-9]\d{9}$/).optional(),
  internalNotes: z.string().trim().max(500).optional(),
}).strict().superRefine((input, context) => {
  if (!input.partnerId && (!input.name || !input.phone)) {
    context.addIssue({ code: 'custom', path: ['partnerId'], message: 'Select a delivery partner or provide a name and phone number.' });
  }
});
export const bulkDeliveryPartnerSchema = z.object({
  partnerId: z.string().regex(/^[a-f\d]{24}$/i),
  orderIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(100),
  internalNotes: z.string().trim().max(500).optional(),
}).strict().superRefine((input, context) => {
  if (new Set(input.orderIds).size !== input.orderIds.length) {
    context.addIssue({ code: 'custom', path: ['orderIds'], message: 'Each order can be included only once.' });
  }
});
export const internalNoteSchema = z.object({
  note: z.string().trim().min(1).max(1000),
}).strict();
export const orderPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const orderListQuerySchema = orderPaginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  paymentStatus: z.enum(['pending_verification', 'confirmed', 'rejected', 'refunded']).optional(),
  fulfilmentStatus: z.enum([...FULFILMENT_STATUS_ENUM]).optional(),
  deliveryStatus: z.enum([...DELIVERY_STATUS_ENUM]).optional(),
  cancellationRequest: z.enum(['pending', 'reviewed']).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((query, context) => {
  if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
    context.addIssue({ code: 'custom', path: ['from'], message: '`from` must be earlier than or equal to `to`.' });
  }
});
