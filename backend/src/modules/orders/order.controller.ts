import { CashRemittance } from './cashRemittance.model.js';
import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../utils/AppError.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { sendData, sendPage } from '../../utils/apiResponse.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { User } from '../auth/user.model.js';
import { InventoryAdjustment } from '../inventory/inventoryAdjustment.model.js';
import { Product } from '../catalog/product.model.js';
import { Settings } from '../settings/settings.model.js';
import { SellerApplication } from '../seller/sellerApplication.model.js';
import { Seller } from '../../models/Seller.js';
import { Order, DELIVERY_EXCEPTION_REASON_CODES, RIDER_REQUESTED_ACTIONS } from './order.model.js';
import { PenaltyLedger } from './penaltyLedger.model.js';
import {
  cancellationRequestSchema,
  cancellationReviewSchema,
  bulkDeliveryPartnerSchema,
  createOrderSchema,
  customerBankAccountSchema,
  deliveryPartnerSchema,
  directCancelOrderSchema,
  fulfilmentUpdateSchema,
  internalNoteSchema,
  orderIdParamsSchema,
  orderListQuerySchema,
  orderPaginationQuerySchema,
  partnerAvailabilitySchema,
  paymentReviewSchema,
  reportDeliveryFailureSchema,
  returnRequestInputSchema,
  reverseOrderPartnerStatusSchema,
} from './order.schemas.js';
import { createOrder } from './order.service.js';
import { enqueueOrderStatusNotification } from '../notifications/orderNotification.service.js';
import {
  canAssignDeliveryPartner,
  canCustomerDirectCancel,
  canPartnerTransitionOrder,
  haversineDistanceKm,
  nextFulfilmentStatus,
  statusAfterDeliveryPartnerAssignment,
} from './order.transitions.js';
import { autoAssignOrderById, autoDispatchPendingOrders } from './autoDispatch.worker.js';

export async function resolveOrderSellerPickup(order: {
  sellerPickup?: {
    sellerId?: unknown;
    sellerName?: string | null;
    phoneE164?: string | null;
    address?: string | null;
    city?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  items?: Array<{ sellerId?: unknown }>;
  address?: { city?: string | null } | null;
}): Promise<{
  sellerId?: string | undefined;
  sellerName: string;
  phoneE164?: string | undefined;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  enrolmentId?: string | undefined;
  panNumber?: string | undefined;
}> {
  const sellerId = order.sellerPickup?.sellerId || order.items?.find((item) => item.sellerId)?.sellerId;
  if (order.sellerPickup?.sellerName && order.sellerPickup?.address) {
    const sellerProfile = sellerId ? await Seller.findOne({ userId: sellerId }).lean() : null;
    return {
      sellerId: sellerId ? String(sellerId) : undefined,
      sellerName: order.sellerPickup.sellerName,
      phoneE164: order.sellerPickup.phoneE164 ?? undefined,
      address: order.sellerPickup.address,
      city: order.sellerPickup.city ?? order.address?.city ?? 'Damoh',
      latitude: order.sellerPickup.latitude ?? 23.8388,
      longitude: order.sellerPickup.longitude ?? 79.4422,
      ...(sellerProfile?.taxDetails?.enrolmentId || sellerProfile?.taxDetails?.gstin
        ? { enrolmentId: sellerProfile.taxDetails.enrolmentId || sellerProfile.taxDetails.gstin }
        : {}),
      ...(sellerProfile?.taxDetails?.panNumber ? { panNumber: sellerProfile.taxDetails.panNumber } : {}),
    };
  }
  if (!sellerId) {
    return {
      sellerName: 'Damoh SHG Seller',
      address: 'Civil Ward, Station Road, Damoh, Madhya Pradesh 470661',
      city: order.address?.city ?? 'Damoh',
      latitude: 23.8388,
      longitude: 79.4422,
    };
  }
  const sellerUser = await User.findById(sellerId).select('name phoneE164 assignedCity currentLocation').lean();
  let sellerApp = await SellerApplication.findOne({ sellerId, status: 'approved' })
    .sort({ reviewedAt: -1, createdAt: -1 })
    .lean();
  if (!sellerApp && sellerUser?.phoneE164) {
    sellerApp = await SellerApplication.findOne({ phoneE164: sellerUser.phoneE164, status: 'approved' })
      .sort({ reviewedAt: -1, createdAt: -1 })
      .lean();
  }
  const sellerProfile = await Seller.findOne({ userId: sellerId }).lean();
  const city = sellerProfile?.pickupAddress?.city || sellerApp?.city || sellerUser?.assignedCity || order.address?.city || 'Damoh';
  const pickupAddressStr = sellerProfile?.pickupAddress
    ? `${sellerProfile.pickupAddress.streetAddress}, ${sellerProfile.pickupAddress.locality ? sellerProfile.pickupAddress.locality + ', ' : ''}${sellerProfile.pickupAddress.city}, ${sellerProfile.pickupAddress.state} - ${sellerProfile.pickupAddress.pincode}`
    : sellerApp?.registeredAddress || `Civil Ward, ${city}, Madhya Pradesh 470661`;
  return {
    sellerId: String(sellerId),
    sellerName: sellerProfile?.supplierDetails?.shgName || sellerProfile?.supplierDetails?.shgLeaderName || sellerApp?.shgName || sellerUser?.name || sellerApp?.representative || 'Damoh SHG Seller',
    ...(sellerApp?.phoneE164 || sellerUser?.phoneE164 ? { phoneE164: sellerApp?.phoneE164 || sellerUser?.phoneE164 } : {}),
    address: pickupAddressStr,
    city,
    latitude: sellerApp?.latitude ?? sellerUser?.currentLocation?.latitude ?? 23.8388,
    longitude: sellerApp?.longitude ?? sellerUser?.currentLocation?.longitude ?? 79.4422,
    ...(sellerProfile?.taxDetails?.enrolmentId || sellerProfile?.taxDetails?.gstin
      ? { enrolmentId: sellerProfile.taxDetails.enrolmentId || sellerProfile.taxDetails.gstin }
      : {}),
    ...(sellerProfile?.taxDetails?.panNumber ? { panNumber: sellerProfile.taxDetails.panNumber } : {}),
  };
}

export const createOrderController: RequestHandler = async (req, res) => {
  const input = createOrderSchema.parse(req.body);
  const { order, created } = await createOrder(authenticatedUserId(req), input);
  const settings = await Settings.findOne({ key: 'global' })
    .select('upiId upiQrUrl upiInstructions cashInstructions').lean();
  const paymentInstructions = input.paymentMethod === 'upi'
    ? { method: 'upi', upiId: settings?.upiId, qrImageUrl: settings?.upiQrUrl, instructions: settings?.upiInstructions || 'Scan and pay via any UPI app (GPay, PhonePe, Paytm, BHIM).' }
    : input.paymentMethod === 'razorpay'
      ? { method: 'razorpay', instructions: 'Payment authorized via Razorpay Gateway (Cards, UPI, NetBanking, Wallets).' }
    : input.paymentMethod === 'card'
      ? { method: 'card', instructions: 'Payment via Debit/Credit Card (Visa/MasterCard/RuPay) confirmed. Electronic invoice generated.' }
      : input.paymentMethod === 'netbanking'
        ? { method: 'netbanking', instructions: 'Net Banking transaction authorized with your Indian bank.' }
        : input.paymentMethod === 'doorstep_upi'
          ? { method: 'doorstep_upi', instructions: 'Doorstep UPI selected: Delivery partner will present dynamic UPI QR code on arrival for 1-tap scan.' }
          : { method: 'cash', instructions: settings?.cashInstructions || 'Please keep exact cash ready upon doorstep package delivery.' };
  const sellerPickup = await resolveOrderSellerPickup(order.toObject());
  sendData(res, { order: toCustomerOrder({ ...order.toObject(), sellerPickup }), paymentInstructions }, created ? 201 : 200);
};

export const listMyOrders: RequestHandler = async (req, res) => {
  const query = orderPaginationQuerySchema.parse(req.query);
  const customerId = authenticatedUserId(req);
  const [orders, total] = await Promise.all([
    Order.find({ customerId }).select('-internalNotes -paymentEvents -idempotencyKey -deliveryPartner.userId -deliveryPartnerHistory -cancellationRequest.reviewedBy -cancellationRequest.adminNote').sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit).limit(query.limit).lean(),
    Order.countDocuments({ customerId }),
  ]);
  const enriched = await Promise.all(orders.map(async (order) => {
    const sellerPickup = await resolveOrderSellerPickup(order);
    return toCustomerOrder({ ...order, sellerPickup });
  }));
  sendPage(res, enriched, query.page, query.limit, total);
};

export const getMyOrder: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const order = await Order.findOne({ _id: id, customerId: authenticatedUserId(req) })
    .select('-internalNotes -paymentEvents -idempotencyKey -cancellationRequest.reviewedBy -cancellationRequest.adminNote').lean();
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
  const [settings, sellerPickup] = await Promise.all([
    order.fulfilmentMethod === 'pickup'
      ? Settings.findOne({ key: 'global' }).select('pickupInstructions').lean()
      : Promise.resolve(null),
    resolveOrderSellerPickup(order),
  ]);
  sendData(res, {
    ...toCustomerOrder({ ...order, sellerPickup }),
    ...(settings?.pickupInstructions ? { pickupInstructions: settings.pickupInstructions } : {}),
  });
};

export const getCustomerBankAccount: RequestHandler = async (req, res) => {
  const userId = authenticatedUserId(req);
  const user = await User.findById(userId).select('bankAccount name phoneE164').lean();
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found.');
  sendData(res, {
    bankAccount: user.bankAccount ?? {
      accountHolderName: user.name || '',
      accountNumber: '',
      ifscCode: '',
      bankName: '',
      upiId: '',
      verified: false,
    },
  });
};

export const upsertCustomerBankAccount: RequestHandler = async (req, res) => {
  const userId = authenticatedUserId(req);
  const input = customerBankAccountSchema.parse(req.body);
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found.');

  user.bankAccount = {
    accountHolderName: input.accountHolderName.trim(),
    accountNumber: input.accountNumber.trim(),
    ifscCode: input.ifscCode.trim().toUpperCase(),
    bankName: input.bankName.trim(),
    ...(input.upiId ? { upiId: input.upiId.trim() } : {}),
    linkedAt: new Date(),
    verified: true,
  };
  await user.save();

  await AuditLog.create({
    actorId: userId,
    action: 'customer.bank_account_linked',
    resourceType: 'user',
    resourceId: String(user._id),
    metadata: { bankName: input.bankName, ifscCode: input.ifscCode.toUpperCase() },
  });

  sendData(res, { bankAccount: user.bankAccount });
};

export const cancelOrderDirect: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const input = directCancelOrderSchema.parse(req.body ?? {});
  const customerId = authenticatedUserId(req);

  const session = await mongoose.startSession();
  let updatedOrder: InstanceType<typeof Order> | null = null;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: id, customerId }).session(session);
      if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found.');

      if (!canCustomerDirectCancel(order.fulfilmentStatus) || Boolean(order.deliveryPartner?.userId)) {
        throw new AppError(
          409,
          'DIRECT_CANCEL_NOT_ALLOWED',
          'Direct cancellation is only allowed before the seller marks the order Ready for Pickup and before a partner is assigned.',
        );
      }

      for (const item of order.items) {
        const filter = item.variantId
          ? { _id: item.productId, 'variants._id': item.variantId }
          : { _id: item.productId };
        const update = item.variantId
          ? { $inc: { 'variants.$.stock': item.quantity } }
          : { $inc: { stock: item.quantity } };
        await Product.updateOne(filter, update, { session });
        await InventoryAdjustment.create(
          [
            {
              productId: item.productId,
              ...(item.variantId ? { variantId: item.variantId } : {}),
              quantityChange: item.quantity,
              reason: 'Direct customer pre-dispatch cancellation (ORDER_CANCELLED)',
              actorId: customerId,
              orderId: order._id,
            },
          ],
          { session },
        );
      }

      const reasonNote = input.reason || 'Customer cancelled order directly prior to Seller Ready-for-Pickup.';
      order.fulfilmentStatus = 'cancelled';
      order.cancellationReason = reasonNote;
      order.statusHistory.push({
        status: 'cancelled',
        changedAt: new Date(),
        actorType: 'user',
        actorId: new mongoose.Types.ObjectId(customerId),
        note: `ORDER_CANCELLED (Pre-dispatch direct cancellation): ${reasonNote}`,
      });
      await order.save({ session });
      await enqueueOrderStatusNotification(order, 'cancelled', session);
      await AuditLog.create(
        [
          {
            actorId: customerId,
            action: 'order.cancelled_direct_pre_dispatch',
            resourceType: 'order',
            resourceId: String(order._id),
            metadata: { orderReference: order.orderReference, reason: reasonNote },
          },
        ],
        { session },
      );
      updatedOrder = order;
    });
  } finally {
    await session.endSession();
  }

  if (!updatedOrder) throw new AppError(500, 'INTERNAL_ERROR', 'Order could not be cancelled.');
  const sellerPickup = await resolveOrderSellerPickup((updatedOrder as InstanceType<typeof Order>).toObject());
  sendData(res, toCustomerOrder({ ...(updatedOrder as InstanceType<typeof Order>).toObject(), sellerPickup }));
};

export const submitCustomerReturnRequest: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const input = returnRequestInputSchema.parse(req.body);
  const customerId = authenticatedUserId(req);

  const [customer, order] = await Promise.all([
    User.findById(customerId).select('bankAccount name phoneE164').lean(),
    Order.findOne({ _id: id, customerId }),
  ]);

  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
  if (!customer?.bankAccount?.verified || !customer.bankAccount.accountNumber) {
    throw new AppError(
      409,
      'BANK_ACCOUNT_REQUIRED',
      'Link your Bank Account to proceed with Returns & Refunds.',
    );
  }

  if (order.fulfilmentStatus !== 'delivered' && order.fulfilmentStatus !== 'completed') {
    throw new AppError(
      409,
      'RETURN_NOT_ELIGIBLE',
      'Returns can only be requested for delivered orders.',
    );
  }

  const deliveredHistoryEntry = [...(order.statusHistory ?? [])]
    .reverse()
    .find((entry) => entry.status === 'delivered' || entry.status === 'completed');
  const deliveredAt = deliveredHistoryEntry?.changedAt
    ? new Date(deliveredHistoryEntry.changedAt)
    : new Date(order.updatedAt ?? order.createdAt);
  const elapsedMs = Date.now() - deliveredAt.getTime();
  const fourDaysMs = 4 * 24 * 60 * 60 * 1000;

  if (elapsedMs > fourDaysMs) {
    throw new AppError(
      409,
      'RETURN_WINDOW_EXPIRED',
      'Return window for this product has expired.',
    );
  }

  if (!order.preDispatchInspection?.imageUrls || order.preDispatchInspection.imageUrls.length < 5) {
    order.preDispatchInspection = {
      imageUrls: [
        '/images/products/chanderi-silk-saree.jpg',
        '/images/products/zardozi-clutch.jpg',
        '/images/products/bamboo-tokri.jpg',
        '/images/products/terracotta-diya.jpg',
        '/images/products/multani-mitti-soap.jpg',
      ],
      inspectionNote: 'Baseline 5-angle pre-dispatch verification photos recorded at seller handover.',
      uploadedAt: deliveredAt,
    };
  }

  const isLowValueReturn = (order.totalPaise || 0) <= 30000;
  order.fulfilmentStatus = isLowValueReturn ? 'return_accepted' : 'return_requested';
  order.returnRequest = {
    status: isLowValueReturn ? 'accepted' : 'requested',
    reasonCode: input.reasonCode,
    reasonText: input.reasonText,
    boxConditionImages: input.boxConditionImages,
    productFaultImages: input.productFaultImages,
    requestedBy: new mongoose.Types.ObjectId(customerId),
    requestedAt: new Date(),
    ...(isLowValueReturn
      ? {
          arbitration: {
            decision: 'approved',
            faultAttribution: 'no_fault',
            penaltyAmountPaise: 0,
            reviewNote: 'Automated Instant Approval: Order value under ₹300 policy threshold.',
          },
        }
      : {}),
  };
  order.statusHistory.push({
    status: isLowValueReturn ? 'return_accepted' : 'return_requested',
    changedAt: new Date(),
    actorType: isLowValueReturn ? 'system' : 'user',
    ...(isLowValueReturn ? {} : { actorId: new mongoose.Types.ObjectId(customerId) }),
    note: isLowValueReturn
      ? 'Return automatically approved under ₹300 low-value policy. Ready for reverse pickup.'
      : `RETURN_REQUESTED (${input.reasonCode.replaceAll('_', ' ')}): ${input.reasonText}`,
  });

  await order.save();
  if (isLowValueReturn) {
    await autoAssignOrderById(order._id).catch(() => null);
  }
  await AuditLog.create({
    actorId: customerId,
    action: 'order.return_requested',
    resourceType: 'order',
    resourceId: String(order._id),
    metadata: {
      orderReference: order.orderReference,
      reasonCode: input.reasonCode,
      boxImagesCount: input.boxConditionImages.length,
      faultImagesCount: input.productFaultImages.length,
    },
  });

  const sellerPickup = await resolveOrderSellerPickup(order.toObject());
  sendData(res, toCustomerOrder({ ...order.toObject(), sellerPickup }));
};

export const requestOrderCancellation: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const input = cancellationRequestSchema.parse(req.body);
  const order = await Order.findOneAndUpdate(
    {
      _id: id,
      customerId: authenticatedUserId(req),
      fulfilmentStatus: { $in: ['placed', 'order_confirmed', 'accepted'] },
      'cancellationRequest.requestedAt': { $exists: false },
    },
    {
      $set: {
        'cancellationRequest.requestedAt': new Date(),
        ...(input.note ? { 'cancellationRequest.customerNote': input.note } : {}),
      },
    },
    { new: true },
  );
  if (!order) throw new AppError(409, 'CANCELLATION_NOT_ALLOWED', 'This order cannot be cancelled or already has a cancellation request.');
  await AuditLog.create({
    actorId: authenticatedUserId(req),
    action: 'order.cancellation_requested',
    resourceType: 'order',
    resourceId: String(order.id),
    metadata: { orderReference: order.orderReference },
  });
  sendData(res, toCustomerOrder(order.toObject()));
};

export const listAdminOrders: RequestHandler = async (req, res) => {
  const query = orderListQuerySchema.parse(req.query);
  const filter = {
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.fulfilmentStatus ? { fulfilmentStatus: query.fulfilmentStatus } : {}),
    ...(query.cancellationRequest === 'pending' ? {
      'cancellationRequest.requestedAt': { $exists: true },
      'cancellationRequest.decision': { $exists: false },
    } : {}),
    ...(query.cancellationRequest === 'reviewed' ? {
      'cancellationRequest.requestedAt': { $exists: true },
      'cancellationRequest.decision': { $exists: true },
    } : {}),
    ...(query.from || query.to ? {
      createdAt: {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      },
    } : {}),
    ...(query.q ? {
      $or: [
        { orderReference: { $regex: escapeRegex(query.q), $options: 'i' } },
        { customerName: { $regex: escapeRegex(query.q), $options: 'i' } },
        { customerPhoneE164: { $regex: escapeRegex(query.q), $options: 'i' } },
      ],
    } : {}),
  };
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit).limit(query.limit).lean(),
    Order.countDocuments(filter),
  ]);
  sendPage(res, orders, query.page, query.limit, total);
};

export const getAdminOrder: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const order = await Order.findById(id).lean();
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
  const sellerPickup = await resolveOrderSellerPickup(order);
  const city = order.address?.city || sellerPickup.city || 'Damoh';
  const cityAdmin = await User.findOne({
    role: 'city_admin',
    assignedCity: new RegExp(`^${escapeRegex(city)}$`, 'i'),
  }).select('_id name phoneE164 email assignedCity').lean();
  sendData(res, {
    ...order,
    sellerPickup,
    ...(cityAdmin ? {
      cityAdminDetails: {
        _id: String(cityAdmin._id),
        name: cityAdmin.name || 'City Admin',
        phoneE164: cityAdmin.phoneE164,
        email: cityAdmin.email,
        assignedCity: cityAdmin.assignedCity || city,
      },
    } : {}),
  });
};

export const updateFulfilmentStatus: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const { status, note } = fulfilmentUpdateSchema.parse(req.body);
  const order = await Order.findById(id);
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found.');

  if (nextFulfilmentStatus(order.fulfilmentStatus, order.fulfilmentMethod) !== status && !(order.fulfilmentMethod === 'delivery' && ((order.fulfilmentStatus === 'preparing' && status === 'ready_for_pickup') || (order.fulfilmentStatus === 'ready_for_pickup' && status === 'out_for_delivery')))) {
    throw new AppError(409, 'INVALID_STATUS_TRANSITION', 'That fulfilment status transition is not allowed.');
  }
  if (status === 'out_for_delivery' && order.fulfilmentMethod === 'delivery' && !order.deliveryPartner) {
    throw new AppError(409, 'DELIVERY_PARTNER_REQUIRED', 'Assign a delivery partner before marking this order out for delivery.');
  }
  const priorStatus = order.fulfilmentStatus;
  const actorId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let updatedOrder;
  try {
    updatedOrder = await session.withTransaction(async () => {
      const updated = await Order.findOneAndUpdate(
        {
          _id: id,
          fulfilmentStatus: priorStatus,
          ...(status === 'out_for_delivery' && order.fulfilmentMethod === 'delivery' ? { 'deliveryPartner.name': { $exists: true } } : {}),
        },
        {
          $set: { fulfilmentStatus: status },
          $push: {
            statusHistory: {
              status,
              changedAt: new Date(),
              actorType: 'user',
              actorId,
              ...(note ? { note } : {}),
            },
          },
        },
        { new: true, session },
      );
      if (!updated) throw new AppError(409, 'INVALID_STATUS_TRANSITION', 'The order status changed; reload and try again.');
      await enqueueOrderStatusNotification(updated, status, session);
      await AuditLog.create([{
        actorId,
        action: 'order.fulfilment_updated',
        resourceType: 'order',
        resourceId: String(updated.id),
        metadata: { status },
      }], { session });
      return updated;
    });
  } finally {
    await session.endSession();
  }
  if (!updatedOrder) throw new AppError(500, 'INTERNAL_ERROR', 'The fulfilment status could not be updated.');
  if (status === 'ready_for_pickup' && updatedOrder.fulfilmentMethod === 'delivery') {
    void autoAssignOrderById(updatedOrder.id).catch(() => null);
  }
  sendData(res, updatedOrder);
};

export const assignDeliveryPartner: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const input = deliveryPartnerSchema.parse(req.body);
  const actorId = authenticatedUserId(req);
  const order = await Order.findOne({ _id: id, fulfilmentMethod: 'delivery', fulfilmentStatus: { $in: ['ready_for_pickup', 'delivery_partner_assigned', 'out_for_pickup', 'delivery_failed'] } });
  if (!order || !canAssignDeliveryPartner(order.fulfilmentStatus, Boolean(order.deliveryPartner))) {
    throw new AppError(409, 'DELIVERY_PARTNER_NOT_ALLOWED', 'A delivery partner can only be assigned to an unassigned delivery order being prepared or delivered, or reassigned after a failed delivery attempt.');
  }

  if (!input.partnerId && (!input.name || !input.phone)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'A delivery partner name and phone number are required.');
  }
  const priorAssignment = order.deliveryPartner && (order.fulfilmentStatus === 'delivery_failed' || !input.partnerId || order.deliveryPartner.userId?.toString() !== input.partnerId) ? {
    ...(order.deliveryPartner.userId ? { userId: order.deliveryPartner.userId } : {}),
    name: order.deliveryPartner.name,
    phoneE164: order.deliveryPartner.phoneE164,
    assignedAt: order.deliveryPartner.assignedAt,
    assignedBy: order.deliveryPartner.assignedBy,
    unassignedAt: new Date(),
    unassignedBy: new mongoose.Types.ObjectId(actorId),
  } : undefined;

  const session = await mongoose.startSession();
  let updated;
  try {
    updated = await session.withTransaction(async () => {
      const partnerUser = input.partnerId
        ? await User.findOne({ _id: input.partnerId, role: 'delivery_partner', status: 'active' })
          .select('_id name phoneE164').session(session).lean()
        : undefined;
      if (input.partnerId && !partnerUser) {
        throw new AppError(404, 'DELIVERY_PARTNER_NOT_FOUND', 'The selected partner is not an active delivery partner.');
      }
      const assigned = await Order.findOneAndUpdate(
        {
          _id: id,
          fulfilmentMethod: 'delivery',
          fulfilmentStatus: { $in: ['ready_for_pickup', 'delivery_partner_assigned', 'out_for_pickup', 'delivery_failed'] },
          $or: [{ deliveryPartner: { $exists: false } }, { fulfilmentStatus: 'delivery_failed' }],
        },
        {
          $set: {
            ...(order.fulfilmentStatus === 'delivery_failed'
              ? { fulfilmentStatus: statusAfterDeliveryPartnerAssignment(order.fulfilmentStatus) }
              : {}),
            deliveryPartner: {
              ...(partnerUser ? { userId: partnerUser._id } : {}),
              name: partnerUser?.name ?? input.name ?? '',
              phoneE164: partnerUser?.phoneE164 ?? (input.phone?.startsWith('+91') ? input.phone : `+91${input.phone}`),
              ...(input.internalNotes ? { internalNotes: input.internalNotes } : {}),
              assignedAt: new Date(),
              assignedBy: actorId,
            },
          },
          ...((priorAssignment || order.fulfilmentStatus === 'delivery_failed') ? {
            $push: {
              ...(priorAssignment ? { deliveryPartnerHistory: priorAssignment } : {}),
              ...(order.fulfilmentStatus === 'delivery_failed' ? {
                statusHistory: {
                  status: statusAfterDeliveryPartnerAssignment(order.fulfilmentStatus),
                  changedAt: new Date(),
                  actorType: 'user',
                  actorId,
                  note: 'Delivery partner reassigned after a failed delivery attempt.',
                },
              } : {}),
            },
          } : {}),
        },
        { new: true, runValidators: true, session },
      );
      if (!assigned) throw new AppError(409, 'DELIVERY_PARTNER_NOT_ALLOWED', 'The order changed and the delivery partner was not assigned.');
      await AuditLog.create([{
        actorId,
        action: priorAssignment ? 'order.delivery_partner_reassigned' : 'order.delivery_partner_assigned',
        resourceType: 'order',
        resourceId: assigned.id,
        metadata: { orderReference: assigned.orderReference },
      }], { session });
      return assigned;
    });
  } finally {
    await session.endSession();
  }
  if (!updated) throw new AppError(500, 'INTERNAL_ERROR', 'The delivery partner could not be assigned.');
  sendData(res, updated);
};

export const bulkAssignDeliveryPartner: RequestHandler = async (req, res) => {
  const input = bulkDeliveryPartnerSchema.parse(req.body);
  const actorId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let assignedOrders: Awaited<ReturnType<typeof Order.find>>;
  try {
    const result = await session.withTransaction(async () => {
      const partner = await User.findOne({ _id: input.partnerId, role: 'delivery_partner', status: 'active' })
        .select('_id name phoneE164').session(session).lean();
      if (!partner) throw new AppError(404, 'DELIVERY_PARTNER_NOT_FOUND', 'The selected partner is not an active delivery partner.');
      const orders = await Order.find({
        _id: { $in: input.orderIds },
        fulfilmentMethod: 'delivery',
        fulfilmentStatus: { $in: ['ready_for_pickup', 'delivery_partner_assigned', 'out_for_pickup', 'delivery_failed'] },
      }).session(session);
      if (orders.length !== input.orderIds.length || orders.some((order) => !canAssignDeliveryPartner(order.fulfilmentStatus, Boolean(order.deliveryPartner)))) {
        throw new AppError(409, 'DELIVERY_PARTNER_NOT_ALLOWED', 'One or more selected orders are ineligible: assigned orders can only be reassigned after a failed delivery attempt.');
      }

      const assigned = [];
      for (const order of orders) {
        const wasAssigned = Boolean(order.deliveryPartner);
        if (order.deliveryPartner) {
          order.deliveryPartnerHistory.push({
            ...(order.deliveryPartner.userId ? { userId: order.deliveryPartner.userId } : {}),
            name: order.deliveryPartner.name,
            phoneE164: order.deliveryPartner.phoneE164,
            assignedAt: order.deliveryPartner.assignedAt,
            assignedBy: order.deliveryPartner.assignedBy,
            unassignedAt: new Date(),
            unassignedBy: new mongoose.Types.ObjectId(actorId),
          });
        }
        order.deliveryPartner = {
          userId: partner._id,
          name: partner.name ?? 'Delivery Partner',
          phoneE164: partner.phoneE164,
          ...(input.internalNotes ? { internalNotes: input.internalNotes } : {}),
          assignedAt: new Date(),
          assignedBy: new mongoose.Types.ObjectId(actorId),
        };
        if (order.fulfilmentStatus === 'delivery_failed') {
          order.fulfilmentStatus = statusAfterDeliveryPartnerAssignment(order.fulfilmentStatus);
          order.statusHistory.push({
            status: order.fulfilmentStatus,
            changedAt: new Date(),
            actorType: 'user',
            actorId: new mongoose.Types.ObjectId(actorId),
            note: 'Delivery partner reassigned after a failed delivery attempt.',
          });
        }
        await order.save({ session });
        assigned.push({ order, wasAssigned });
      }

      await AuditLog.create(assigned.map(({ order, wasAssigned }) => ({
        actorId,
        action: wasAssigned ? 'order.delivery_partner_reassigned' : 'order.delivery_partner_assigned',
        resourceType: 'order',
        resourceId: order.id,
        metadata: { orderReference: order.orderReference, partnerId: partner._id.toString() },
      })), { session });
      return assigned.map(({ order }) => order);
    });
    assignedOrders = result ?? [];
  } finally {
    await session.endSession();
  }
  sendData(res, assignedOrders);
};

const INACTIVE_PARTNER_ORDER_STATES = [
  'delivered',
  'completed',
  'cancelled',
  'delivery_failed',
  'return_requested',
  'return_rejected',
  'return_accepted',
  'return_delivered_to_seller',
  'ready_for_refund',
  'refund_completed',
] as const;

function getPartnerOrderMatchFilter(partnerId: string, phone?: string): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [
    { 'deliveryPartner.userId': partnerId },
    { 'returnRequest.reverseDeliveryPartner.userId': partnerId },
  ];
  if (mongoose.Types.ObjectId.isValid(partnerId)) {
    const partnerObjectId = new mongoose.Types.ObjectId(partnerId);
    conditions.push(
      { 'deliveryPartner.userId': partnerObjectId },
      { 'returnRequest.reverseDeliveryPartner.userId': partnerObjectId }
    );
  }
  if (phone) {
    conditions.push(
      { 'deliveryPartner.phoneE164': phone },
      { 'returnRequest.reverseDeliveryPartner.phoneE164': phone }
    );
  }
  return { $or: conditions };
}

export const getPartnerProfile: RequestHandler = async (req, res) => {
  const partnerId = authenticatedUserId(req);
  const partnerUser = (req as any).user;
  const partner = await User.findById(partnerId)
    .select('name phoneE164 assignedCity serviceableLocalities isOnline availabilityStatus currentLocation remittancePin remittancePinExpiresAt')
    .lean();
  if (!partner) throw new AppError(404, 'NOT_FOUND', 'Delivery partner profile not found.');

  const partnerPhone = partner.phoneE164 || partnerUser?.phoneE164 || partnerUser?.phone;
  const partnerFilter = getPartnerOrderMatchFilter(partnerId, partnerPhone);

  const activeCount = await Order.countDocuments({
    ...partnerFilter,
    fulfilmentStatus: { $nin: INACTIVE_PARTNER_ORDER_STATES },
  });

  const isOnline = partner.isOnline ?? true;
  const availabilityStatus = !isOnline
    ? 'offline'
    : activeCount > 0
      ? 'busy'
      : partner.availabilityStatus === 'offline'
        ? 'available'
        : (partner.availabilityStatus ?? 'available');

  const unremittedOrders = await Order.find({
    ...partnerFilter,
    fulfilmentStatus: { $in: ['delivered', 'completed'] },
    $or: [{ paymentMethod: 'cash' }, { 'doorstepPayment.mode': 'cash' }],
    'doorstepPayment.remittedToCityAdmin': { $ne: true },
  }).select('totalPaise').lean();
  const unremittedCashPaise = unremittedOrders.reduce((acc, curr) => acc + (curr.totalPaise || 0), 0);

  sendData(res, {
    _id: String(partner._id),
    name: partner.name || 'Delivery Partner',
    phoneE164: partner.phoneE164,
    assignedCity: partner.assignedCity || 'Damoh',
    serviceableLocalities: partner.serviceableLocalities ?? [],
    isOnline,
    availabilityStatus,
    activeOrderCount: activeCount,
    unremittedCashPaise,
    remittancePin: (partner as any).remittancePin || '8392',
    remittancePinExpiresAt: (partner as any).remittancePinExpiresAt,
    expiresInSeconds: (partner as any).remittancePinExpiresAt
      ? Math.max(0, Math.floor(((new Date((partner as any).remittancePinExpiresAt)).getTime() - Date.now()) / 1000))
      : 60,
    exceedsCodThreshold: unremittedCashPaise > 200000,
    currentLocation: {
      latitude: partner.currentLocation?.latitude ?? 23.8415,
      longitude: partner.currentLocation?.longitude ?? 79.445,
      updatedAt: partner.currentLocation?.updatedAt ?? new Date(),
    },
  });
};

export const updatePartnerAvailability: RequestHandler = async (req, res) => {
  const partnerId = authenticatedUserId(req);
  const input = partnerAvailabilitySchema.parse(req.body);
  const partner = await User.findById(partnerId);
  if (!partner) throw new AppError(404, 'NOT_FOUND', 'Delivery partner profile not found.');

  // Condition 2: Check unremitted cash before going offline
  if (input.isOnline === false || input.availabilityStatus === 'offline') {
    const unrem = await Order.find({
      'deliveryPartner.userId': partnerId,
      fulfilmentStatus: { $in: ['delivered', 'completed'] },
      $or: [{ paymentMethod: 'cash' }, { 'doorstepPayment.mode': 'cash' }],
      'doorstepPayment.remittedToCityAdmin': { $ne: true },
    }).select('totalPaise').lean();
    const unremittedCashPaise = unrem.reduce((acc, curr) => acc + (curr.totalPaise || 0), 0);
    if (unremittedCashPaise > 0) {
      throw new AppError(
        400,
        'UNREMITTED_CASH_HOLD',
        `Cannot go offline. You have ₹${(unremittedCashPaise / 100).toFixed(2)} in unremitted cash in hand. Cash must be deposited to the City Admin Hub (using your Handshake PIN) or remitted via UPI before ending your shift.`,
      );
    }
  }

  if (typeof input.isOnline === 'boolean') {
    partner.isOnline = input.isOnline;
    if (!input.isOnline) {
      partner.availabilityStatus = 'offline';
    } else if (partner.availabilityStatus === 'offline') {
      partner.availabilityStatus = 'available';
    }
  }
  if (input.availabilityStatus) {
    partner.availabilityStatus = input.availabilityStatus;
    if (input.availabilityStatus === 'offline') {
      partner.isOnline = false;
    } else {
      partner.isOnline = true;
    }
  }
  if (input.latitude !== undefined && input.longitude !== undefined) {
    partner.currentLocation = {
      latitude: input.latitude,
      longitude: input.longitude,
      updatedAt: new Date(),
    };
  } else if (!partner.currentLocation?.latitude || !partner.currentLocation?.longitude) {
    partner.currentLocation = {
      latitude: 23.8415,
      longitude: 79.445,
      updatedAt: new Date(),
    };
  }
  await partner.save();
  if (partner.isOnline) {
    void autoDispatchPendingOrders().catch(() => null);
  }
  sendData(res, {
    _id: String(partner._id),
    isOnline: partner.isOnline ?? true,
    availabilityStatus: partner.availabilityStatus ?? 'available',
    currentLocation: partner.currentLocation,
  });
};

export const listAssignedPartnerOrders: RequestHandler = async (req, res) => {
  const partnerId = authenticatedUserId(req);
  const partnerUser = (req as any).user;
  const partnerPhone = partnerUser?.phoneE164 || partnerUser?.phone;
  const partnerFilter = getPartnerOrderMatchFilter(partnerId, partnerPhone);
  const orders = await Order.find({
    ...partnerFilter,
    fulfilmentStatus: { $nin: INACTIVE_PARTNER_ORDER_STATES },
  })
    .select('-internalNotes -paymentEvents -idempotencyKey -deliveryPartnerHistory -deliveryPartner.internalNotes -deliveryPartner.assignedBy -deliveryPartner.userId -cancellationRequest.reviewedBy -cancellationRequest.adminNote -deliveryOtp')
    .sort({ createdAt: -1 })
    .lean();

  const enrichedOrders = await Promise.all(orders.map(async (order) => {
    const sellerPickup = await resolveOrderSellerPickup(order);
    return {
      ...order,
      sellerPickup,
      address: order.address
        ? {
          ...order.address,
          latitude: order.address.latitude ?? 23.8452,
          longitude: order.address.longitude ?? 79.4486,
        }
        : undefined,
    };
  }));

  sendData(res, enrichedOrders);
};

export const listPartnerDeliveryHistory: RequestHandler = async (req, res) => {
  const partnerId = authenticatedUserId(req);
  const partnerUser = (req as any).user;
  const partnerPhone = partnerUser?.phoneE164 || partnerUser?.phone;
  const partnerFilter = getPartnerOrderMatchFilter(partnerId, partnerPhone);
  const orders = await Order.find({
    fulfilmentStatus: {
      $in: [
        'delivered',
        'completed',
        'delivery_failed',
        'cancelled',
        'return_delivered_to_seller',
        'ready_for_refund',
        'refund_completed',
      ],
    },
    ...partnerFilter,
  })
    .select('orderReference items.productName items.quantity items.unitPricePaise items.lineTotalPaise fulfilmentMethod fulfilmentStatus paymentMethod paymentStatus totalPaise deliveryFeePaise createdAt updatedAt statusHistory.status statusHistory.changedAt deliveryPartner customerName customerPhoneE164 deliveryOtp address sellerPickup returnRequest')
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();
  sendData(res, orders);
};

export const updatePartnerOrderStatus: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const { status, note, paymentCollected, reasonCode, reasonNotes, proofImageUrl, riderRequestedAction, deliveryOtp, paymentMode, upiUtr } = z.object({
    status: z.enum([
      'out_for_pickup',
      'picked_up',
      'out_for_delivery',
      'delivered',
      'delivery_failed',
      'return_picked_up',
      'return_delivered_to_seller',
    ]),
    note: z.string().trim().max(500).optional(),
    paymentCollected: z.boolean().optional(),
    reasonCode: z.enum(DELIVERY_EXCEPTION_REASON_CODES).optional(),
    reasonNotes: z.string().trim().max(1000).optional(),
    proofImageUrl: z.string().trim().nullish().transform((v) => v ?? null),
    riderRequestedAction: z.enum(RIDER_REQUESTED_ACTIONS).optional(),
    deliveryOtp: z.string().trim().max(6).optional(),
    paymentMode: z.enum(['cash', 'upi_qr', 'prepaid_online']).optional(),
    upiUtr: z.string().trim().max(30).optional(),
  }).strict().parse(req.body);
  const partnerId = authenticatedUserId(req);
  const partnerUser = (req as any).user;
  const partnerPhone = partnerUser?.phoneE164 || partnerUser?.phone;
  const partnerFilter = getPartnerOrderMatchFilter(partnerId, partnerPhone);
  const order = await Order.findOne({
    _id: id,
    ...partnerFilter,
  });
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found for this delivery partner.');

  const priorStatus = order.fulfilmentStatus;
  if (priorStatus === status || (status === 'delivered' && priorStatus === 'completed')) {
    return sendData(res, order);
  }
  if (!canPartnerTransitionOrder(priorStatus, status)) {
    throw new AppError(409, 'INVALID_STATUS_TRANSITION', `Cannot transition order from ${priorStatus.replaceAll('_', ' ')} to ${status.replaceAll('_', ' ')}.`);
  }

  const isPrepaidOrder = order.paymentStatus === 'confirmed' || order.paymentMethod !== 'cash';
  if (status === 'delivered' && isPrepaidOrder && order.deliveryOtp) {
    if (!deliveryOtp || deliveryOtp.trim() !== order.deliveryOtp.trim()) {
      throw new AppError(
        400,
        'INVALID_DELIVERY_OTP',
        'Invalid Customer Delivery OTP. Please ask the customer for their 4-digit verification code.'
      );
    }
  }

  const defaultNotes: Record<string, string> = {
    out_for_pickup: 'Delivery Partner accepted assignment and is en route to Seller for pickup.',
    picked_up: 'Delivery Partner reached Seller and picked up the package.',
    out_for_delivery: 'Delivery Partner is on the way to Customer address for delivery.',
    delivered: paymentCollected
      ? 'Package delivered to Customer and payment collected/confirmed.'
      : 'Package delivered to Customer.',
    delivery_failed: 'Delivery attempt could not be completed.',
    return_picked_up: 'Return item picked up from Customer location; agent is in transit to Seller.',
    return_delivered_to_seller: 'Return package handed over to Seller and reverse delivery confirmed.',
  };

  const session = await mongoose.startSession();
  let updated;
  try {
    updated = await session.withTransaction(async () => {
      const shouldConfirmPayment = status === 'delivered' && (paymentCollected || order.paymentMethod === 'cash' || isPrepaidOrder || paymentMode === 'upi_qr');
      const effectiveMode = isPrepaidOrder ? 'prepaid_online' : (paymentMode || 'cash');
      const doorstepPaymentData = status === 'delivered' ? {
        mode: effectiveMode,
        upiUtr: upiUtr || undefined,
        collectedAmountPaise: effectiveMode === 'prepaid_online' ? 0 : order.totalPaise,
        collectedAt: new Date(),
        notes: effectiveMode === 'upi_qr'
          ? `Paid at door via Dynamic UPI QR (Ref: ${upiUtr || 'Confirmed'})`
          : effectiveMode === 'cash'
            ? `Paid in cash: ₹${(order.totalPaise / 100).toFixed(2)}`
            : 'Prepaid online order delivered.',
      } : undefined;
      const finalLat =
        status === 'delivered' || status === 'return_picked_up'
          ? (order.address?.latitude ?? order.deliveryPartner?.latitude ?? 23.8342)
          : status === 'picked_up' || status === 'return_delivered_to_seller'
            ? (order.sellerPickup?.latitude ?? order.deliveryPartner?.latitude ?? 23.8388)
            : order.deliveryPartner?.latitude;
      const finalLng =
        status === 'delivered' || status === 'return_picked_up'
          ? (order.address?.longitude ?? order.deliveryPartner?.longitude ?? 79.4385)
          : status === 'picked_up' || status === 'return_delivered_to_seller'
            ? (order.sellerPickup?.longitude ?? order.deliveryPartner?.longitude ?? 79.4422)
            : order.deliveryPartner?.longitude;

      let nextFulfilmentStatusVal: string = status;
      const returnSubUpdates: Record<string, unknown> = {};
      if (status === 'return_picked_up' && order.returnRequest) {
        returnSubUpdates['returnRequest.status'] = 'picked_up';
        returnSubUpdates['returnRequest.reverseDeliveryPartner.pickedUpAt'] = new Date();
      } else if (status === 'return_delivered_to_seller' && order.returnRequest) {
        returnSubUpdates['returnRequest.status'] = 'delivered_to_seller';
        returnSubUpdates['returnRequest.reverseDeliveryPartner.deliveredToSellerAt'] = new Date();
        nextFulfilmentStatusVal = 'return_delivered_to_seller';
      }

      let nextDeliveryStatus = order.deliveryStatus || 'UNASSIGNED';
      const failureCount = status === 'delivery_failed' ? (order.deliveryExceptions?.length || 0) + 1 : 0;

      // Autonomous Return Pickup Assignment when Delivery Failure is raised
      let assignedReturnPartnerObj: Record<string, unknown> | null = null;
      let isPartnerReplacedOrCleared = false;
      let autoReturnHistoryEvents: Array<Record<string, unknown>> = [];
      let historyEntry: Record<string, unknown> | null = null;

      if (status === 'delivered') {
        nextDeliveryStatus = 'DELIVERED';
      } else if (status === 'out_for_delivery') {
        nextDeliveryStatus = 'OUT_FOR_DELIVERY';
      } else if (status === 'out_for_pickup' || status === 'picked_up') {
        nextDeliveryStatus = 'ASSIGNED';
      } else if (status === 'delivery_failed') {
        isPartnerReplacedOrCleared = true;
        nextDeliveryStatus = 'RETURN_TO_ORIGIN';

        const currentRider = await User.findById(partnerId)
          .select('_id name phoneE164 isOnline availabilityStatus currentLocation assignedCity')
          .session(session)
          .lean();

        const isCurrentRiderOnline =
          Boolean(currentRider) &&
          currentRider?.isOnline !== false &&
          currentRider?.availabilityStatus !== 'offline';

        const riderNeedsReplacement =
          !isCurrentRiderOnline ||
          riderRequestedAction === 'UNASSIGN_ME' ||
          reasonCode === 'RIDER_VEHICLE_ISSUE' ||
          reasonCode === 'RIDER_EMERGENCY';

        const targetLat = order.address?.latitude ?? order.sellerPickup?.latitude ?? 23.8342;
        const targetLng = order.address?.longitude ?? order.sellerPickup?.longitude ?? 79.4385;

        let chosenPartner: typeof currentRider = null;
        let isSameRiderReassigned = false;
        let chosenDistanceKm = 0.5;

        if (!riderNeedsReplacement && currentRider) {
          chosenPartner = currentRider;
          isSameRiderReassigned = true;
          const rLat = currentRider.currentLocation?.latitude ?? order.deliveryPartner?.latitude ?? targetLat;
          const rLng = currentRider.currentLocation?.longitude ?? order.deliveryPartner?.longitude ?? targetLng;
          chosenDistanceKm = haversineDistanceKm(targetLat, targetLng, rLat, rLng) ?? 0.4;
        } else {
          // Current rider is offline or requested replacement: find nearest ONLINE delivery partner
          const otherOnlinePartners = await User.find({
            _id: { $ne: new mongoose.Types.ObjectId(partnerId) },
            role: 'delivery_partner',
            status: 'active',
            isOnline: true,
            availabilityStatus: { $ne: 'offline' },
          })
            .select('_id name phoneE164 isOnline availabilityStatus currentLocation assignedCity')
            .session(session)
            .lean();

          let shortestDist = Infinity;
          for (const candidate of otherOnlinePartners) {
            const cLat = candidate.currentLocation?.latitude ?? 23.8415;
            const cLng = candidate.currentLocation?.longitude ?? 79.445;
            const dist = haversineDistanceKm(targetLat, targetLng, cLat, cLng) ?? 999;
            if (dist < shortestDist) {
              shortestDist = dist;
              chosenPartner = candidate;
            }
          }

          if (chosenPartner) {
            isSameRiderReassigned = false;
            chosenDistanceKm = Number.isFinite(shortestDist) ? Number(shortestDist.toFixed(2)) : 0.8;
          } else if (isCurrentRiderOnline && currentRider) {
            // Fallback to current online rider if no other rider is online in the city
            chosenPartner = currentRider;
            isSameRiderReassigned = true;
            chosenDistanceKm = 0.4;
          }
        }

        const reasonLabelMap: Record<string, string> = {
          CUSTOMER_UNAVAILABLE: 'Customer Unavailable / Phone Unreachable',
          INCORRECT_ADDRESS: 'Incorrect or Incomplete Address',
          CUSTOMER_REFUSED: 'Customer Refused Delivery at Door',
          RIDER_VEHICLE_ISSUE: 'Delivery Partner Vehicle Breakdown',
          WEATHER_OR_ROAD_BLOCK: 'Weather or Road Block Delay',
          RIDER_EMERGENCY: 'Delivery Partner Emergency',
          OTHER: 'Delivery Exception',
        };
        const readableReason = reasonLabelMap[reasonCode || 'OTHER'] || reasonCode || 'Delivery Exception';
        const reasonDetail = (reasonNotes || note || 'Customer doorstep handover could not be completed').trim();

        // 1. Always push the "Delivery Delayed / Failed" message for the customer
        autoReturnHistoryEvents.push({
          status: 'delivery_failed',
          changedAt: new Date(),
          actorType: 'user',
          actorId: new mongoose.Types.ObjectId(partnerId),
          note: `⚠️ Delivery Delayed / Attempt Failed (${readableReason}): ${reasonDetail}. Initiating automatic Return Pickup to Seller.`,
        });

        if (chosenPartner) {
          const pLat = chosenPartner.currentLocation?.latitude ?? order.deliveryPartner?.latitude ?? 23.8388;
          const pLng = chosenPartner.currentLocation?.longitude ?? order.deliveryPartner?.longitude ?? 79.4422;

          // If the same online rider already has the package in hand, go straight to return_picked_up (Hand Over to Seller)
          const hasPackageInHand =
            isSameRiderReassigned && ['picked_up', 'out_for_delivery'].includes(priorStatus);
          nextFulfilmentStatusVal = hasPackageInHand ? 'return_picked_up' : 'return_partner_assigned';

          assignedReturnPartnerObj = {
            userId: chosenPartner._id,
            name: chosenPartner.name || 'Delivery Partner',
            phoneE164: chosenPartner.phoneE164 || '',
            distanceKm: chosenDistanceKm,
            latitude: pLat,
            longitude: pLng,
            assignedAt: new Date(),
            assignedBy: new mongoose.Types.ObjectId(partnerId),
          };

          returnSubUpdates['returnRequest'] = {
            status: hasPackageInHand ? 'picked_up' : 'partner_assigned',
            reasonCode: 'other',
            reasonText: `Auto-Return Order (${readableReason}): ${reasonDetail}`,
            boxConditionImages: proofImageUrl ? [proofImageUrl] : [],
            productFaultImages: [],
            requestedAt: new Date(),
            reverseDeliveryPartner: {
              userId: chosenPartner._id,
              name: chosenPartner.name || 'Delivery Partner',
              phoneE164: chosenPartner.phoneE164 || '',
              distanceKm: chosenDistanceKm,
              latitude: pLat,
              longitude: pLng,
              assignedAt: new Date(),
              assignedBy: new mongoose.Types.ObjectId(partnerId),
              ...(hasPackageInHand ? { pickedUpAt: new Date() } : {}),
            },
          };

          returnSubUpdates['adminResolution'] = {
            resolvedBy: new mongoose.Types.ObjectId(partnerId),
            resolvedAt: new Date(),
            action: 'TRIGGER_RTO',
            adminNotes: isSameRiderReassigned
              ? `Auto-Assigned Return Pickup to SAME online partner (${chosenPartner.name} · ${chosenPartner.phoneE164 || ''}). No manual City Admin action needed.`
              : `Previous partner offline/unavailable — Auto-Assigned Return Pickup to NEARBY online partner (${chosenPartner.name} · ${chosenPartner.phoneE164 || ''}, ${chosenDistanceKm} km away). No manual City Admin action needed.`,
          };

          // 2. Push the "Return Pickup Partner Assigned" message for the customer
          autoReturnHistoryEvents.push({
            status: nextFulfilmentStatusVal,
            changedAt: new Date(Date.now() + 500),
            actorType: 'system',
            actorId: new mongoose.Types.ObjectId(partnerId),
            note: isSameRiderReassigned
              ? `🔄 Return Pickup Partner Assigned: ${chosenPartner.name || 'Delivery Partner'} (${chosenPartner.phoneE164 || 'On-Duty'}) is online and has been automatically reassigned to return the parcel to ${order.sellerPickup?.sellerName || 'Artisan SHG Seller'}.`
              : `🔄 Nearby Return Partner Assigned: Previous partner was offline/unavailable. Nearest online partner ${chosenPartner.name || 'Delivery Partner'} (${chosenPartner.phoneE164 || 'On-Duty'}, ${chosenDistanceKm} km away) has been automatically assigned to return the parcel to ${order.sellerPickup?.sellerName || 'Artisan SHG Seller'}.`,
          });

          if (!isSameRiderReassigned && order.deliveryPartner) {
            historyEntry = {
              ...(order.deliveryPartner.userId ? { userId: order.deliveryPartner.userId } : {}),
              name: order.deliveryPartner.name,
              phoneE164: order.deliveryPartner.phoneE164,
              assignedAt: order.deliveryPartner.assignedAt,
              assignedBy: order.deliveryPartner.assignedBy,
              unassignedAt: new Date(),
              unassignedBy: new mongoose.Types.ObjectId(partnerId),
              changeReason: `Delivery failed [${readableReason}]: Auto-reassigned return pickup to nearby online partner ${chosenPartner.name}.`,
            };
          }
        } else {
          // No online partner at all right now: queue for auto-dispatch return
          nextFulfilmentStatusVal = 'return_accepted';
          assignedReturnPartnerObj = null;
          returnSubUpdates['returnRequest'] = {
            status: 'accepted',
            reasonCode: 'other',
            reasonText: `Auto-Return Order (${readableReason}): ${reasonDetail}. Queued for nearest online partner.`,
            boxConditionImages: proofImageUrl ? [proofImageUrl] : [],
            productFaultImages: [],
            requestedAt: new Date(),
          };
          autoReturnHistoryEvents.push({
            status: 'return_accepted',
            changedAt: new Date(Date.now() + 500),
            actorType: 'system',
            actorId: new mongoose.Types.ObjectId(partnerId),
            note: `⏳ Return Pickup Scheduled: Waiting for nearest delivery partner to come online to return parcel to ${order.sellerPickup?.sellerName || 'Artisan SHG Seller'}.`,
          });
        }
      }

      const exceptionData = (status === 'delivery_failed') ? {
        attemptedAt: new Date(),
        riderId: new mongoose.Types.ObjectId(partnerId),
        reasonCode: reasonCode || 'OTHER',
        reasonNotes: reasonNotes || note || 'Delivery attempt failed — auto-converted to Return Pickup',
        proofImageUrl: proofImageUrl || null,
        riderRequestedAction: riderRequestedAction || 'RETRY_LATER',
      } : null;

      const changed = await Order.findOneAndUpdate(
        { _id: id, fulfilmentStatus: priorStatus },
        {
          $set: {
            fulfilmentStatus: nextFulfilmentStatusVal,
            deliveryStatus: nextDeliveryStatus,
            ...(shouldConfirmPayment ? { paymentStatus: 'confirmed' } : {}),
            ...(status === 'delivered' ? {
              doorstepPayment: {
                mode: paymentMode || (order.paymentMethod === 'cash' ? 'cash' : 'prepaid_online'),
                upiUtr: upiUtr || undefined,
                collectedAmountPaise: order.totalPaise,
                collectedAt: new Date(),
                remittedToCityAdmin: paymentMode === 'upi_qr' || paymentMode === 'prepaid_online' || order.paymentMethod !== 'cash',
                remittedAt: (paymentMode === 'upi_qr' || paymentMode === 'prepaid_online' || order.paymentMethod !== 'cash') ? new Date() : undefined,
                remittedReceiptNumber: paymentMode === 'upi_qr' ? `ONLINE-UPI-${Date.now().toString().slice(-6)}` : undefined,
              },
            } : {}),
            ...(isPartnerReplacedOrCleared
              ? { deliveryPartner: assignedReturnPartnerObj }
              : {
                  ...(finalLat !== undefined ? { 'deliveryPartner.latitude': finalLat } : {}),
                  ...(finalLng !== undefined ? { 'deliveryPartner.longitude': finalLng } : {}),
                }),
            ...returnSubUpdates,
          },
          $push: {
            statusHistory:
              autoReturnHistoryEvents.length > 0
                ? { $each: autoReturnHistoryEvents }
                : {
                    status: nextFulfilmentStatusVal,
                    changedAt: new Date(),
                    actorType: 'user',
                    actorId: partnerId,
                    note: note || defaultNotes[status] || `Status updated to ${status}`,
                  },
            ...(exceptionData ? { deliveryExceptions: exceptionData } : {}),
            ...(historyEntry ? { deliveryPartnerHistory: historyEntry } : {}),
            ...(shouldConfirmPayment && order.paymentStatus !== 'confirmed'
              ? {
                paymentEvents: {
                  status: 'confirmed',
                  actorId: new mongoose.Types.ObjectId(partnerId),
                  note: note || 'Payment collected and settled upon delivery by Delivery Partner.',
                  createdAt: new Date(),
                },
              }
              : {}),
          },
        },
        { new: true, session },
      ).select('-internalNotes -paymentEvents -idempotencyKey -deliveryPartnerHistory -deliveryPartner.internalNotes -deliveryPartner.assignedBy -deliveryPartner.userId -cancellationRequest.reviewedBy -cancellationRequest.adminNote -statusHistory.actorId -statusHistory.actorType');
      if (!changed) throw new AppError(409, 'INVALID_STATUS_TRANSITION', 'The order status changed; reload and try again.');

      if (status === 'delivery_failed') {
        const newAssignedUserId = assignedReturnPartnerObj?.userId
          ? String(assignedReturnPartnerObj.userId)
          : null;
        if (newAssignedUserId && newAssignedUserId !== String(partnerId)) {
          await User.updateOne(
            { _id: newAssignedUserId },
            { $set: { isOnline: true, availabilityStatus: 'busy' } },
            { session },
          );
          await User.updateOne(
            { _id: partnerId },
            { $set: { availabilityStatus: 'available' } },
            { session },
          );
        } else if (newAssignedUserId === String(partnerId)) {
          await User.updateOne(
            { _id: partnerId },
            { $set: { isOnline: true, availabilityStatus: 'busy' } },
            { session },
          );
        }
      } else if (status === 'delivered' || status === 'return_delivered_to_seller') {
        const remainingActiveOrders = await Order.countDocuments({
          _id: { $ne: changed._id },
          $or: [
            { 'deliveryPartner.userId': partnerId },
            { 'returnRequest.reverseDeliveryPartner.userId': partnerId },
          ],
          fulfilmentStatus: { $nin: INACTIVE_PARTNER_ORDER_STATES },
        }).session(session);
        if (remainingActiveOrders === 0) {
          await User.updateOne(
            { _id: partnerId },
            { $set: { isOnline: true, availabilityStatus: 'available' } },
            { session },
          );
        }
      } else {
        await User.updateOne(
          { _id: partnerId },
          { $set: { isOnline: true, availabilityStatus: 'busy' } },
          { session },
        );
      }

      await enqueueOrderStatusNotification(changed, status, session);
      await AuditLog.create([{
        actorId: partnerId,
        action: 'order.fulfilment_updated',
        resourceType: 'order',
        resourceId: changed.id,
        metadata: { priorStatus, status, paymentCollected: Boolean(paymentCollected) },
      }], { session });
      return changed;
    });
  } finally {
    await session.endSession();
  }
  if (!updated) throw new AppError(500, 'INTERNAL_ERROR', 'The delivery status could not be updated.');
  const sellerPickup = await resolveOrderSellerPickup(updated.toObject());
  sendData(res, {
    ...updated.toObject(),
    sellerPickup,
    streamStatus:
      status === 'delivered' ||
      status === 'delivery_failed' ||
      status === 'return_delivered_to_seller'
        ? 'GPS_STREAM_INACTIVE'
        : 'GPS_STREAM_ACTIVE',
  });
};

export const reportPartnerDeliveryFailure: RequestHandler = async (req, res, next) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const parsed = reportDeliveryFailureSchema.parse(req.body);
  req.body = {
    status: 'delivery_failed',
    note: parsed.reasonNotes,
    ...parsed,
  };
  return updatePartnerOrderStatus(req, res, next);
};

export const updatePartnerReverseOrderStatus: RequestHandler = async (req, res) => {
  const parsed = reverseOrderPartnerStatusSchema.parse(req.body);
  req.body = { status: parsed.status, ...(parsed.note ? { note: parsed.note } : {}) };
  return updatePartnerOrderStatus(req, res, () => undefined);
};

export const getPartnerSettlements: RequestHandler = async (req, res) => {
  const partnerId = authenticatedUserId(req);
  const [completedOrders, penalties] = await Promise.all([
    Order.find({
      $or: [
        { 'deliveryPartner.userId': partnerId },
        { 'returnRequest.reverseDeliveryPartner.userId': partnerId },
      ],
      fulfilmentStatus: {
        $in: [
          'delivered',
          'completed',
          'return_delivered_to_seller',
          'ready_for_refund',
          'refund_completed',
        ],
      },
    })
      .select('orderReference totalPaise deliveryFeePaise fulfilmentStatus updatedAt createdAt')
      .sort({ updatedAt: -1 })
      .lean(),
    PenaltyLedger.find({
      partyType: 'delivery_partner',
      partyId: partnerId,
      settlementStatus: { $ne: 'WAIVED' },
    })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const grossDeliveryEarningsPaise = completedOrders.reduce((sum, o) => {
    const basePayout = o.deliveryFeePaise && o.deliveryFeePaise > 0 ? o.deliveryFeePaise : 4500;
    const reverseBonus =
      o.fulfilmentStatus === 'return_delivered_to_seller' ||
      o.fulfilmentStatus === 'ready_for_refund' ||
      o.fulfilmentStatus === 'refund_completed'
        ? 3500
        : 0;
    return sum + basePayout + reverseBonus;
  }, 0);

  const totalPenaltyDeductionsPaise = penalties.reduce((sum, p) => sum + (p.penaltyAmountPaise ?? 0), 0);
  const netSettlementPaise = Math.max(0, grossDeliveryEarningsPaise - totalPenaltyDeductionsPaise);

  sendData(res, {
    monthLabel: new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
    completedDeliveriesCount: completedOrders.length,
    grossDeliveryEarningsPaise,
    totalPenaltyDeductionsPaise,
    netSettlementPaise,
    completedTrips: completedOrders.map((o) => ({
      orderId: String(o._id),
      orderReference: o.orderReference,
      fulfilmentStatus: o.fulfilmentStatus,
      payoutPaise:
        (o.deliveryFeePaise && o.deliveryFeePaise > 0 ? o.deliveryFeePaise : 4500) +
        (['return_delivered_to_seller', 'ready_for_refund', 'refund_completed'].includes(o.fulfilmentStatus)
          ? 3500
          : 0),
      completedAt: o.updatedAt ?? o.createdAt,
    })),
    penalties: penalties.map((p) => ({
      _id: String(p._id),
      orderId: String(p.orderId),
      orderReference: p.orderReference,
      penaltyAmountPaise: p.penaltyAmountPaise,
      reason: p.reason,
      settlementStatus: p.settlementStatus,
      createdAt: p.createdAt,
    })),
  });
};

export const broadcastPartnerOrderLocation: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const { latitude, longitude } = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).strict().parse(req.body);

  const partnerId = authenticatedUserId(req);
  const order = await Order.findOne({
    _id: id,
    $or: [
      { 'deliveryPartner.userId': partnerId },
      { 'returnRequest.reverseDeliveryPartner.userId': partnerId },
    ],
  });
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found for this delivery partner.');

  const activeTrackingStates = new Set([
    'delivery_partner_assigned',
    'out_for_pickup',
    'picked_up',
    'out_for_delivery',
    'return_partner_assigned',
    'return_picked_up',
  ]);

  if (!activeTrackingStates.has(order.fulfilmentStatus)) {
    sendData(res, {
      orderId: String(order._id),
      fulfilmentStatus: order.fulfilmentStatus,
      streamStatus: 'GPS_STREAM_INACTIVE' as const,
      active: false,
      message: 'Order is no longer in active transit. Stop GPS coordinate broadcast immediately.',
    });
    return;
  }

  const sellerPickup = await resolveOrderSellerPickup(order.toObject());
  const distanceKm = haversineDistanceKm(sellerPickup.latitude, sellerPickup.longitude, latitude, longitude) ?? 0;
  const updatedAt = new Date();

  await Promise.all([
    Order.updateOne(
      { _id: order._id },
      {
        $set: {
          'deliveryPartner.latitude': latitude,
          'deliveryPartner.longitude': longitude,
          'deliveryPartner.distanceKm': distanceKm,
          ...(order.returnRequest?.reverseDeliveryPartner
            ? {
              'returnRequest.reverseDeliveryPartner.latitude': latitude,
              'returnRequest.reverseDeliveryPartner.longitude': longitude,
              'returnRequest.reverseDeliveryPartner.distanceKm': distanceKm,
            }
            : {}),
        },
      },
    ),
    User.updateOne(
      { _id: partnerId },
      {
        $set: {
          isOnline: true,
          currentLocation: {
            latitude,
            longitude,
            updatedAt,
          },
        },
      },
    ),
  ]);

  sendData(res, {
    orderId: String(order._id),
    fulfilmentStatus: order.fulfilmentStatus,
    streamStatus: 'GPS_STREAM_ACTIVE' as const,
    active: true,
    latitude,
    longitude,
    distanceKm,
    updatedAt: updatedAt.toISOString(),
  });
};

export const reviewPayment: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const input = paymentReviewSchema.parse(req.body);
  const actorId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let order;
  try {
    order = await session.withTransaction(async () => {
      const reviewed = await Order.findOneAndUpdate(
        { _id: id, paymentStatus: 'pending_verification', fulfilmentStatus: { $ne: 'cancelled' } },
        {
          $set: { paymentStatus: input.status },
          $push: { paymentEvents: { status: input.status, actorId, note: input.note, createdAt: new Date() } },
        },
        { new: true, runValidators: true, session },
      );
      if (!reviewed) throw new AppError(409, 'PAYMENT_ALREADY_REVIEWED', 'Payment is not awaiting verification.');
      await AuditLog.create([{
        actorId,
        action: 'order.payment_reviewed',
        resourceType: 'order',
        resourceId: reviewed.id,
        metadata: { status: input.status },
      }], { session });
      return reviewed;
    });
  } finally {
    await session.endSession();
  }
  if (!order) throw new AppError(500, 'INTERNAL_ERROR', 'The payment review could not be saved.');
  sendData(res, order);
};

export const reviewCancellation: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const input = cancellationReviewSchema.parse(req.body);
  const actorId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let result: unknown;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({
        _id: id,
        'cancellationRequest.requestedAt': { $exists: true },
        'cancellationRequest.decision': { $exists: false },
      }).session(session);
      if (!order) throw new AppError(409, 'CANCELLATION_ALREADY_REVIEWED', 'There is no pending cancellation request.');
      if (input.decision === 'approved') {
        if (!['placed', 'order_confirmed', 'accepted'].includes(order.fulfilmentStatus)) {
          throw new AppError(409, 'CANCELLATION_NOT_ALLOWED', 'The order can no longer be cancelled.');
        }
        if (order.paymentStatus === 'confirmed') {
          throw new AppError(409, 'REFUND_POLICY_UNCONFIGURED', 'A confirmed payment cannot be cancelled until a refund policy is configured.');
        }
        for (const item of order.items) {
          const filter = item.variantId
            ? { _id: item.productId, 'variants._id': item.variantId }
            : { _id: item.productId };
          const update = item.variantId
            ? { $inc: { 'variants.$.stock': item.quantity } }
            : { $inc: { stock: item.quantity } };
          const restored = await Product.updateOne(filter, update, { session });
          if (restored.modifiedCount !== 1) {
            throw new AppError(409, 'INVENTORY_RESTORE_FAILED', 'Inventory could not be restored; contact support.');
          }
          await InventoryAdjustment.create([{
            productId: item.productId,
            ...(item.variantId ? { variantId: item.variantId } : {}),
            quantityChange: item.quantity,
            reason: 'Approved order cancellation',
            actorId,
            orderId: order._id,
          }], { session });
        }
        order.fulfilmentStatus = 'cancelled';
        order.statusHistory.push({
          status: 'cancelled',
          changedAt: new Date(),
          actorType: 'user',
          actorId,
          ...(input.note ? { note: input.note } : {}),
        });
      }
      const cancellationRequest = order.cancellationRequest;
      if (!cancellationRequest) {
        throw new AppError(409, 'CANCELLATION_NOT_FOUND', 'There is no pending cancellation request.');
      }
      cancellationRequest.reviewedAt = new Date();
      cancellationRequest.reviewedBy = new mongoose.Types.ObjectId(actorId);
      cancellationRequest.decision = input.decision;
      cancellationRequest.adminNote = input.note ?? null;
      await order.save({ session });
      if (input.decision === 'approved') {
        await enqueueOrderStatusNotification(order, 'cancelled', session);
      }
      await AuditLog.create([{
        actorId,
        action: `order.cancellation_${input.decision}`,
        resourceType: 'order',
        resourceId: order.id,
        metadata: { orderReference: order.orderReference },
      }], { session });
      result = order;
    });
  } finally {
    await session.endSession();
  }
  sendData(res, result);
};

export const addInternalNote: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const { note } = internalNoteSchema.parse(req.body);
  const order = await Order.findByIdAndUpdate(id, { $push: { internalNotes: note } }, { new: true });
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
  await AuditLog.create({
    actorId: authenticatedUserId(req),
    action: 'order.note_added',
    resourceType: 'order',
    resourceId: order.id,
  });
  sendData(res, order);
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toCustomerOrder(order: object): Record<string, unknown> {
  const customerOrder = { ...order } as Record<string, unknown>;
  delete customerOrder.internalNotes;
  delete customerOrder.paymentEvents;
  delete customerOrder.idempotencyKey;
  if (typeof customerOrder.cancellationRequest === 'object' && customerOrder.cancellationRequest !== null) {
    const cancellation = { ...customerOrder.cancellationRequest } as Record<string, unknown>;
    delete cancellation.reviewedBy;
    delete cancellation.adminNote;
    customerOrder.cancellationRequest = cancellation;
  }
  if (Array.isArray(customerOrder.statusHistory)) {
    customerOrder.statusHistory = customerOrder.statusHistory.map((entry) => {
      if (typeof entry !== 'object' || entry === null) return entry;
      const customerEntry = { ...entry } as Record<string, unknown>;
      delete customerEntry.actorId;
      delete customerEntry.actorType;
      return customerEntry;
    });
  }
  if (typeof customerOrder.deliveryPartner === 'object' && customerOrder.deliveryPartner !== null) {
    const partner = { ...customerOrder.deliveryPartner } as Record<string, unknown>;
    delete partner.internalNotes;
    delete partner.assignedBy;
    delete partner.userId;
    customerOrder.deliveryPartner = partner;
  }
  delete customerOrder.deliveryPartnerHistory;
  return customerOrder;
}

export const partnerRemitCashViaUpi: RequestHandler = async (req, res) => {
  const partnerId = authenticatedUserId(req);
  const partner = await User.findById(partnerId);
  if (!partner) throw new AppError(404, 'NOT_FOUND', 'Delivery partner not found.');

  const unremittedOrders = await Order.find({
    'deliveryPartner.userId': partnerId,
    fulfilmentStatus: { $in: ['delivered', 'completed'] },
    $or: [{ paymentMethod: 'cash' }, { 'doorstepPayment.mode': 'cash' }],
    'doorstepPayment.remittedToCityAdmin': { $ne: true },
  });

  if (!unremittedOrders.length) {
    throw new AppError(400, 'NO_UNREMITTED_CASH', 'No outstanding cash on delivery orders found.');
  }

  const totalPaise = unremittedOrders.reduce((sum, o) => sum + (o.totalPaise || 0), 0);
  const receiptNumber = `REM-UPI-${Date.now().toString().slice(-6)}`;
  const now = new Date();
  const orderIds = unremittedOrders.map((o) => o._id);
  const orderReferences = unremittedOrders.map((o) => o.orderReference);

  await Order.updateMany(
    { _id: { $in: orderIds } },
    {
      $set: {
        'doorstepPayment.remittedToCityAdmin': true,
        'doorstepPayment.remittedAt': now,
        'doorstepPayment.remittedReceiptNumber': receiptNumber,
      },
    },
  );

  partner.remittancePin = String(Math.floor(1000 + Math.random() * 9000));
  await partner.save();
  if (partner.isOnline) {
    void autoDispatchPendingOrders().catch(() => null);
  }

  const voucher = await CashRemittance.create({
    receiptNumber,
    riderId: partner._id,
    riderName: partner.name || 'Delivery Partner',
    riderPhone: partner.phoneE164,
    city: partner.assignedCity || 'Damoh',
    amountPaise: totalPaise,
    orderIds,
    orderReferences,
    settledByAdminId: partner._id,
    settledByAdminName: 'Digital UPI Direct Remittance',
    handshakePinUsed: 'UPI-DIRECT',
    method: 'digital_upi',
    notes: 'Direct digital UPI remittance from partner app',
    settledAt: now,
  });

  sendData(res, {
    success: true,
    receiptNumber,
    settledAmountPaise: totalPaise,
    settledAmountRupees: (totalPaise / 100).toFixed(2),
    settledOrdersCount: orderIds.length,
    voucherId: String(voucher._id),
    settledAt: now,
  });
};

export const regeneratePartnerRemittancePin: RequestHandler = async (req, res) => {
  const partnerId = authenticatedUserId(req);
  const partner = await User.findById(partnerId);
  if (!partner) throw new AppError(404, 'NOT_FOUND', 'Delivery partner not found.');

  const now = new Date();
  const oldPin = partner.remittancePin;
  const newPin = String(Math.floor(1000 + Math.random() * 9000));

  if (oldPin) {
    (partner as any).previousRemittancePin = oldPin;
    (partner as any).previousPinExpiresAt = new Date(now.getTime() + 30_000); // 30s grace window
  }

  partner.remittancePin = newPin;
  (partner as any).remittancePinExpiresAt = new Date(now.getTime() + 60_000); // 60s TTL
  await partner.save();

  sendData(res, {
    remittancePin: newPin,
    expiresInSeconds: 60,
    generatedAt: now,
    expiresAt: (partner as any).remittancePinExpiresAt,
  });
};
