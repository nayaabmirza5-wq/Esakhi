import { Schema, model } from 'mongoose';
import type { InferSchemaType } from 'mongoose';

export const FULFILMENT_STATUS_ENUM = [
  'placed',
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
  'cancelled',
  'delivery_failed',
  'return_requested',
  'return_rejected',
  'return_accepted',
  'return_partner_assigned',
  'return_picked_up',
  'return_delivered_to_seller',
  'ready_for_refund',
  'refund_completed',
] as const;

export const RETURN_REASON_CODES = [
  'damaged',
  'defective',
  'wrong_item',
  'box_mutilated',
  'changed_mind',
  'other',
] as const;
export type ReturnReasonCode = (typeof RETURN_REASON_CODES)[number];

export const RETURN_FAULT_ATTRIBUTIONS = [
  'seller_fault',
  'delivery_partner_fault',
  'no_fault',
] as const;
export type ReturnFaultAttribution = (typeof RETURN_FAULT_ATTRIBUTIONS)[number];

export const DELIVERY_STATUS_ENUM = [
  'UNASSIGNED',
  'ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERY_FAILED',
  'ESCALATED_TO_ADMIN',
  'DELIVERED',
  'RETURN_TO_ORIGIN',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUS_ENUM)[number];

export const DELIVERY_EXCEPTION_REASON_CODES = [
  'CUSTOMER_UNAVAILABLE',
  'INCORRECT_ADDRESS',
  'CUSTOMER_REFUSED',
  'RIDER_VEHICLE_ISSUE',
  'WEATHER_OR_ROAD_BLOCK',
  'RIDER_EMERGENCY',
  'OTHER',
] as const;
export type DeliveryExceptionReasonCode = (typeof DELIVERY_EXCEPTION_REASON_CODES)[number];

export const RIDER_REQUESTED_ACTIONS = [
  'RETRY_LATER',
  'UNASSIGN_ME',
  'CANCEL_ORDER',
] as const;
export type RiderRequestedAction = (typeof RIDER_REQUESTED_ACTIONS)[number];

export const ADMIN_RESOLUTION_ACTIONS = [
  'REASSIGN_SAME_RIDER',
  'REASSIGN_NEW_RIDER',
  'RESCHEDULE_LATER',
  'TRIGGER_RTO',
] as const;
export type AdminResolutionAction = (typeof ADMIN_RESOLUTION_ACTIONS)[number];

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
    houseNumber: { type: String, trim: true, maxlength: 100 },
    street: { type: String, trim: true, maxlength: 150 },
    area: { type: String, trim: true, maxlength: 100 },
    landmark: { type: String, trim: true, maxlength: 150 },
    villageOrCity: { type: String, trim: true, maxlength: 100 },
    district: { type: String, trim: true, maxlength: 100 },
    formattedAddress: { type: String, trim: true, maxlength: 700 },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    locationAccuracyMeters: { type: Number, min: 0, max: 100_000 },
  },
  { _id: false },
);

const paymentEventSchema = new Schema(
  {
    status: { type: String, enum: ['pending_verification', 'confirmed', 'rejected', 'refunded'], required: true },
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
      enum: [...FULFILMENT_STATUS_ENUM],
      required: true,
    },
    changedAt: { type: Date, required: true, default: Date.now },
    actorType: { type: String, enum: ['user', 'system'], required: true, default: 'user' },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const sellerPickupSchema = new Schema(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'User' },
    sellerName: { type: String, trim: true, maxlength: 160 },
    phoneE164: { type: String, trim: true, maxlength: 20 },
    address: { type: String, trim: true, maxlength: 500 },
    city: { type: String, trim: true, maxlength: 100 },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
  },
  { _id: false },
);

const deliveryPartnerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, trim: true, required: true, maxlength: 120 },
    phoneE164: { type: String, required: true, match: /^\+91[6-9]\d{9}$/ },
    internalNotes: { type: String, trim: true, maxlength: 500 },
    distanceKm: { type: Number, min: 0 },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
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
    changeReason: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: false },
);

const preDispatchInspectionSchema = new Schema(
  {
    imageUrls: { type: [String], default: [] },
    inspectionNote: { type: String, trim: true, maxlength: 500 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date },
  },
  { _id: false },
);

const returnRequestSchema = new Schema(
  {
    status: {
      type: String,
      enum: [
        'requested',
        'rejected',
        'accepted',
        'partner_assigned',
        'picked_up',
        'delivered_to_seller',
        'ready_for_refund',
        'refund_completed',
      ],
      required: true,
    },
    reasonCode: { type: String, enum: RETURN_REASON_CODES, required: true },
    reasonText: { type: String, required: true, trim: true, maxlength: 800 },
    boxConditionImages: { type: [String], default: [] },
    productFaultImages: { type: [String], default: [] },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestedAt: { type: Date, required: true, default: Date.now },
    arbitration: {
      decision: { type: String, enum: ['approved', 'rejected'] },
      faultAttribution: { type: String, enum: RETURN_FAULT_ATTRIBUTIONS },
      penaltyAmountPaise: { type: Number, min: 0, default: 0 },
      penaltyPartyId: { type: Schema.Types.ObjectId, ref: 'User' },
      penaltyLedgerId: { type: Schema.Types.ObjectId, ref: 'PenaltyLedger' },
      reviewNote: { type: String, trim: true, maxlength: 600 },
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      reviewedAt: { type: Date },
    },
    reverseDeliveryPartner: {
      userId: { type: Schema.Types.ObjectId, ref: 'User' },
      name: { type: String, trim: true, maxlength: 120 },
      phoneE164: { type: String, trim: true, maxlength: 20 },
      distanceKm: { type: Number, min: 0 },
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 },
      assignedAt: { type: Date },
      assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      pickedUpAt: { type: Date },
      deliveredToSellerAt: { type: Date },
    },
    escalatedToSuperAdminBy: { type: Schema.Types.ObjectId, ref: 'User' },
    escalatedToSuperAdminAt: { type: Date },
    refund: {
      refundAmountPaise: { type: Number, min: 0 },
      deductionAmountPaise: { type: Number, min: 0, default: 0 },
      deductionNote: { type: String, trim: true },
      bankAccountHolderName: { type: String, trim: true },
      bankAccountNumberMasked: { type: String, trim: true },
      bankName: { type: String, trim: true },
      ifscCode: { type: String, trim: true },
      upiId: { type: String, trim: true },
      transactionReference: { type: String, trim: true },
      processedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      processedAt: { type: Date },
    },
  },
  { _id: false },
);

const deliveryExceptionSchema = new Schema(
  {
    attemptedAt: { type: Date, default: Date.now },
    riderId: { type: Schema.Types.ObjectId, ref: 'User' },
    reasonCode: {
      type: String,
      enum: [...DELIVERY_EXCEPTION_REASON_CODES],
      required: true,
    },
    reasonNotes: { type: String, default: '' },
    proofImageUrl: { type: String, default: null },
    riderRequestedAction: {
      type: String,
      enum: [...RIDER_REQUESTED_ACTIONS],
      default: 'UNASSIGN_ME',
    },
  },
  { _id: true },
);

const adminResolutionSchema = new Schema(
  {
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
    action: {
      type: String,
      enum: [...ADMIN_RESOLUTION_ACTIONS],
    },
    adminNotes: { type: String },
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
    paymentMethod: { type: String, enum: ['upi', 'cash', 'card', 'netbanking', 'doorstep_upi', 'razorpay'], required: true },
    paymentStatus: {
      type: String,
      enum: ['pending_verification', 'confirmed', 'rejected', 'refunded'],
      default: 'pending_verification',
      required: true,
      index: true,
    },
    paymentEvents: { type: [paymentEventSchema], default: [] },
    razorpay: {
      orderId: { type: String, trim: true },
      paymentId: { type: String, trim: true },
      signature: { type: String, trim: true },
    },
    fulfilmentStatus: {
      type: String,
      enum: [...FULFILMENT_STATUS_ENUM],
      default: 'placed',
      required: true,
    },
    statusHistory: { type: [statusHistorySchema], default: [] },
    sellerPickup: { type: sellerPickupSchema },
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
    preDispatchInspection: { type: preDispatchInspectionSchema },
    returnRequest: { type: returnRequestSchema },
    internalNotes: { type: [String], default: [] },
    deliveryStatus: {
      type: String,
      enum: [...DELIVERY_STATUS_ENUM],
      default: 'UNASSIGNED',
      index: true,
    },
    deliveryExceptions: { type: [deliveryExceptionSchema], default: [] },
    adminResolution: { type: adminResolutionSchema },
    deliveryOtp: { type: String, trim: true, maxlength: 6 },
    deliveryOtpVerifiedAt: Date,
    doorstepPayment: {
      mode: { type: String, enum: ['cash', 'upi_qr', 'prepaid_online'], default: 'cash' },
      upiUtr: { type: String, trim: true, maxlength: 30 },
      collectedAmountPaise: { type: Number, min: 0 },
      collectedAt: Date,
      remittedToCityAdmin: { type: Boolean, default: false },
      remittedAt: Date,
      remittedReceiptNumber: { type: String, trim: true },
      receivedByAdminId: { type: Schema.Types.ObjectId, ref: 'User' },
      notes: { type: String, trim: true, maxlength: 300 },
    },
  },
  { timestamps: true },
);

orderSchema.pre('validate', function () {
  const self = this as unknown as { deliveryOtp?: string };
  if (!self.deliveryOtp) {
    self.deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));
  }
});

orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ idempotencyKey: 1, customerId: 1 }, { unique: true });
orderSchema.index({ fulfilmentStatus: 1, paymentStatus: 1, createdAt: -1 });
orderSchema.index({ 'deliveryPartner.userId': 1, createdAt: -1 });
orderSchema.index({ deliveryStatus: 1, createdAt: -1 });

export const Order = model('Order', orderSchema);
export type OrderRecord = InferSchemaType<typeof orderSchema>;
