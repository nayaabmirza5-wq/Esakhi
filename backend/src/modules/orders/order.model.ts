import { Schema, model } from 'mongoose';
import type { InferSchemaType } from 'mongoose';

const orderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, required: true, ref: 'Product' },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    variantId: { type: Schema.Types.ObjectId },
    productName: { type: String, required: true },
    variantAttributes: { type: Map, of: String, default: {} },
    unitPricePaise: { type: Number, required: true, min: 1 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotalPaise: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const addressSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phoneE164: { type: String, required: true },
    addressLine1: { type: String, required: true, trim: true, maxlength: 200 },
    addressLine2: { type: String, trim: true, maxlength: 200 },
    locality: { type: String, required: true, trim: true, maxlength: 100 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, required: true, trim: true, maxlength: 100 },
    postalCode: { type: String, required: true },
  },
  { _id: false },
);

const paymentEventSchema = new Schema(
  {
    status: { type: String, enum: ['pending_verification', 'confirmed', 'rejected'], required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, trim: true, maxlength: 1000 },
    createdAt: { type: Date, default: Date.now, required: true },
  },
  { _id: false },
);

const statusHistorySchema = new Schema(
  {
    status: {
      type: String,
      enum: ['placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'completed', 'cancelled', 'delivery_failed'],
      required: true,
    },
    changedAt: { type: Date, required: true, default: Date.now },
    actorType: { type: String, enum: ['user', 'system'], required: true, default: 'user' },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const deliveryPartnerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, trim: true, required: true, maxlength: 120 },
    phoneE164: { type: String, required: true, match: /^\+91[6-9]\d{9}$/ },
    internalNotes: { type: String, trim: true, maxlength: 500 },
    assignedAt: { type: Date, required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: false },
);

const deliveryPartnerAssignmentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, trim: true, required: true, maxlength: 120 },
    phoneE164: { type: String, required: true, match: /^\+91[6-9]\d{9}$/ },
    assignedAt: { type: Date, required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    unassignedAt: { type: Date, required: true },
    unassignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    orderReference: { type: String, required: true, unique: true },
    idempotencyKey: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    customerName: { type: String, required: true, trim: true, maxlength: 120 },
    customerPhoneE164: { type: String, required: true },
    address: { type: addressSchema },
    deliveryInstructions: { type: String, trim: true, maxlength: 500 },
    fulfilmentMethod: { type: String, enum: ['delivery', 'pickup'], required: true },
    items: { type: [orderItemSchema], required: true },
    subtotalPaise: { type: Number, required: true, min: 0 },
    deliveryFeePaise: { type: Number, required: true, min: 0 },
    totalPaise: { type: Number, required: true, min: 0 },
    reservationExpiresAt: { type: Date, index: true },
    cancellationReason: { type: String, trim: true, maxlength: 300 },
    paymentMethod: { type: String, enum: ['upi', 'cash'], required: true },
    paymentStatus: {
      type: String,
      enum: ['pending_verification', 'confirmed', 'rejected'],
      default: 'pending_verification',
      required: true,
      index: true,
    },
    paymentEvents: { type: [paymentEventSchema], default: [] },
    fulfilmentStatus: {
      type: String,
      enum: ['placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'completed', 'cancelled', 'delivery_failed'],
      default: 'placed',
      required: true,
    },
    statusHistory: { type: [statusHistorySchema], default: [] },
    deliveryPartner: { type: deliveryPartnerSchema },
    deliveryPartnerHistory: { type: [deliveryPartnerAssignmentSchema], default: [] },
    cancellationRequest: {
      requestedAt: Date,
      customerNote: { type: String, trim: true, maxlength: 500 },
      reviewedAt: Date,
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      decision: { type: String, enum: ['approved', 'rejected'] },
      adminNote: { type: String, trim: true, maxlength: 500 },
    },
    internalNotes: { type: [String], default: [] },
  },
  { timestamps: true },
);

orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ idempotencyKey: 1, customerId: 1 }, { unique: true });
orderSchema.index({ fulfilmentStatus: 1, paymentStatus: 1, createdAt: -1 });
orderSchema.index({ 'deliveryPartner.userId': 1, createdAt: -1 });

export const Order = model('Order', orderSchema);
export type OrderRecord = InferSchemaType<typeof orderSchema>;
