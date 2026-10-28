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
import { Order } from './order.model.js';
import {
  cancellationRequestSchema,
  cancellationReviewSchema,
  bulkDeliveryPartnerSchema,
  createOrderSchema,
  fulfilmentUpdateSchema,
  internalNoteSchema,
  orderIdParamsSchema,
  orderListQuerySchema,
  orderPaginationQuerySchema,
  paymentReviewSchema,
} from './order.schemas.js';
import { createOrder } from './order.service.js';
import { deliveryPartnerSchema } from './order.schemas.js';
import { enqueueOrderStatusNotification } from '../notifications/orderNotification.service.js';
import { canAssignDeliveryPartner, nextFulfilmentStatus, statusAfterDeliveryPartnerAssignment } from './order.transitions.js';

export const createOrderController: RequestHandler = async (req, res) => {
  const input = createOrderSchema.parse(req.body);
  const { order, created } = await createOrder(authenticatedUserId(req), input);
  const settings = await Settings.findOne({ key: 'global' })
    .select('upiId upiQrUrl upiInstructions cashInstructions').lean();
  const paymentInstructions = input.paymentMethod === 'upi'
    ? { method: 'upi', upiId: settings?.upiId, qrImageUrl: settings?.upiQrUrl, instructions: settings?.upiInstructions }
    : { method: 'cash', instructions: settings?.cashInstructions };
  sendData(res, { order: toCustomerOrder(order.toObject()), paymentInstructions }, created ? 201 : 200);
};

export const listMyOrders: RequestHandler = async (req, res) => {
  const query = orderPaginationQuerySchema.parse(req.query);
  const customerId = authenticatedUserId(req);
  const [orders, total] = await Promise.all([
    Order.find({ customerId }).select('-internalNotes -paymentEvents -idempotencyKey -deliveryPartner.userId -deliveryPartnerHistory -cancellationRequest.reviewedBy -cancellationRequest.adminNote').sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit).limit(query.limit).lean(),
    Order.countDocuments({ customerId }),
  ]);
  sendPage(res, orders, query.page, query.limit, total);
};

export const getMyOrder: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const order = await Order.findOne({ _id: id, customerId: authenticatedUserId(req) })
    .select('-internalNotes -paymentEvents -idempotencyKey -cancellationRequest.reviewedBy -cancellationRequest.adminNote').lean();
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
  const settings = order.fulfilmentMethod === 'pickup'
    ? await Settings.findOne({ key: 'global' }).select('pickupInstructions').lean()
    : null;
  sendData(res, {
    ...toCustomerOrder(order),
    ...(settings?.pickupInstructions ? { pickupInstructions: settings.pickupInstructions } : {}),
  });
};

export const requestOrderCancellation: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const input = cancellationRequestSchema.parse(req.body);
  const order = await Order.findOneAndUpdate(
    {
      _id: id,
      customerId: authenticatedUserId(req),
      fulfilmentStatus: { $in: ['placed', 'accepted'] },
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
  sendData(res, order);
};

export const updateFulfilmentStatus: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const { status, note } = fulfilmentUpdateSchema.parse(req.body);
  const order = await Order.findById(id);
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found.');

  if (nextFulfilmentStatus(order.fulfilmentStatus, order.fulfilmentMethod) !== status) {
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
  sendData(res, updatedOrder);
};

export const assignDeliveryPartner: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const input = deliveryPartnerSchema.parse(req.body);
  const actorId = authenticatedUserId(req);
  const order = await Order.findOne({ _id: id, fulfilmentMethod: 'delivery', fulfilmentStatus: { $in: ['preparing', 'out_for_delivery', 'delivery_failed'] } });
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
          fulfilmentStatus: { $in: ['preparing', 'out_for_delivery', 'delivery_failed'] },
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
        fulfilmentStatus: { $in: ['preparing', 'out_for_delivery', 'delivery_failed'] },
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

export const listAssignedPartnerOrders: RequestHandler = async (req, res) => {
  const partnerId = authenticatedUserId(req);
  const orders = await Order.find({
    'deliveryPartner.userId': partnerId,
    fulfilmentStatus: { $nin: ['delivered', 'completed', 'cancelled', 'delivery_failed'] },
  })
    .select('-internalNotes -paymentEvents -idempotencyKey -deliveryPartnerHistory -deliveryPartner.internalNotes -deliveryPartner.assignedBy -deliveryPartner.userId -cancellationRequest.reviewedBy -cancellationRequest.adminNote')
    .sort({ createdAt: -1 }).lean();
  sendData(res, orders.map((order) => order.fulfilmentStatus === 'out_for_delivery'
    ? order
    : { ...order, customerName: 'Customer', customerPhoneE164: undefined, customerPhone: undefined, address: undefined }));
};

export const listPartnerDeliveryHistory: RequestHandler = async (req, res) => {
  const partnerId = authenticatedUserId(req);
  const orders = await Order.find({
    fulfilmentStatus: { $in: ['delivered', 'completed', 'delivery_failed', 'cancelled'] },
    $or: [
      { 'deliveryPartner.userId': partnerId },
      { 'deliveryPartnerHistory.userId': partnerId },
    ],
  })
    .select('orderReference items.productName items.quantity fulfilmentMethod fulfilmentStatus createdAt updatedAt statusHistory.status statusHistory.changedAt deliveryPartner.assignedAt address.locality address.city')
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();
  sendData(res, orders);
};

export const updatePartnerOrderStatus: RequestHandler = async (req, res) => {
  const { id } = orderIdParamsSchema.parse(req.params);
  const { status, note } = z.object({
    status: z.enum(['out_for_delivery', 'delivered', 'delivery_failed']),
    note: z.string().trim().max(500).optional(),
  }).strict().parse(req.body);
  const partnerId = authenticatedUserId(req);
  const order = await Order.findOne({ _id: id, 'deliveryPartner.userId': partnerId });
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found for this delivery partner.');

  const priorStatus = order.fulfilmentStatus;
  const allowedTransition = status === 'out_for_delivery' ? priorStatus === 'preparing' || priorStatus === 'ready_for_pickup' :
    status === 'delivered' ? priorStatus === 'out_for_delivery' :
      status === 'delivery_failed' ? priorStatus === 'out_for_delivery' : false;
  if (!allowedTransition) {
    throw new AppError(409, 'INVALID_STATUS_TRANSITION', 'That delivery status transition is not allowed.');
  }

  const session = await mongoose.startSession();
  let updated;
  try {
    updated = await session.withTransaction(async () => {
      const changed = await Order.findOneAndUpdate(
        { _id: id, 'deliveryPartner.userId': partnerId, fulfilmentStatus: priorStatus },
        {
          $set: { fulfilmentStatus: status },
          $push: { statusHistory: { status, changedAt: new Date(), actorType: 'user', actorId: partnerId, ...(note ? { note } : {}) } },
        },
        { new: true, session },
      ).select('-internalNotes -paymentEvents -idempotencyKey -deliveryPartnerHistory -deliveryPartner.internalNotes -deliveryPartner.assignedBy -deliveryPartner.userId -cancellationRequest.reviewedBy -cancellationRequest.adminNote -statusHistory.actorId -statusHistory.actorType');
      if (!changed) throw new AppError(409, 'INVALID_STATUS_TRANSITION', 'The order status changed; reload and try again.');
      await enqueueOrderStatusNotification(changed, status, session);
      await AuditLog.create([{
        actorId: partnerId,
        action: 'order.fulfilment_updated',
        resourceType: 'order',
        resourceId: changed.id,
        metadata: { status },
      }], { session });
      return changed;
    });
  } finally {
    await session.endSession();
  }
  if (!updated) throw new AppError(500, 'INTERNAL_ERROR', 'The delivery status could not be updated.');
  sendData(res, updated);
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
        if (!['placed', 'accepted'].includes(order.fulfilmentStatus)) {
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
