import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../utils/AppError.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { sendData, sendPage } from '../../utils/apiResponse.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { Order } from '../orders/order.model.js';
import { Product } from '../catalog/product.model.js';
import { User } from '../auth/user.model.js';

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const adminDashboard: RequestHandler = async (_req, res) => {
  const [ordersNeedingAction, pendingPayments, recentOrders, lowStockProducts, lowStockVariants] = await Promise.all([
    Order.countDocuments({ fulfilmentStatus: { $in: ['placed', 'accepted', 'preparing'] } }),
    Order.countDocuments({ paymentStatus: 'pending_verification' }),
    Order.find().sort({ createdAt: -1 }).limit(10).select('orderReference customerName totalPaise paymentStatus fulfilmentStatus createdAt').lean(),
    Product.countDocuments({ isArchived: false, variants: { $size: 0 }, $expr: { $lte: ['$stock', '$lowStockThreshold'] } }),
    Product.aggregate([
      { $match: { isArchived: false } },
      { $unwind: '$variants' },
      { $match: { $expr: { $lte: ['$variants.stock', '$lowStockThreshold'] } } },
      { $count: 'total' },
    ]),
  ]);
  sendData(res, {
    ordersNeedingAction,
    pendingPayments,
    lowStockItems: lowStockProducts + (lowStockVariants[0]?.total ?? 0),
    recentOrders,
  });
};

export const listCustomers: RequestHandler = async (req, res) => {
  const { page, limit } = pageSchema.parse(req.query);
  const filter = { role: 'customer' as const };
  const [customers, total] = await Promise.all([
    User.find(filter).select('phoneE164 name status createdAt').sort({ createdAt: -1 })
      .skip((page - 1) * limit).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  sendPage(res, customers, page, limit, total);
};

export const listCustomerOrders: RequestHandler = async (req, res) => {
  const { customerId } = z.object({ customerId: z.string().regex(/^[a-f\d]{24}$/i) }).parse(req.params);
  const { page, limit } = pageSchema.parse(req.query);
  const [orders, total] = await Promise.all([
    Order.find({ customerId }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Order.countDocuments({ customerId }),
  ]);
  sendPage(res, orders, page, limit, total);
};

export const getCustomer: RequestHandler = async (req, res) => {
  const { customerId } = z.object({ customerId: z.string().regex(/^[a-f\d]{24}$/i) }).parse(req.params);
  const customer = await User.findOne({ _id: customerId, role: 'customer' })
    .select('phoneE164 name status createdAt').lean();
  if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found.');
  const orderCount = await Order.countDocuments({ customerId });
  sendData(res, { ...customer, orderCount });
};

export const updateCustomerRole: RequestHandler = async (req, res) => {
  const { userId } = z.object({ userId: z.string().regex(/^[a-f\d]{24}$/i) }).parse(req.params);
  const { role } = z.object({ role: z.enum(['customer', 'staff', 'delivery_partner']) }).strict().parse(req.body);
  const actorId = authenticatedUserId(req);
  if (userId === actorId) throw new AppError(400, 'INVALID_REQUEST', 'You cannot change your own role.');
  const session = await mongoose.startSession();
  let user;
  try {
    user = await session.withTransaction(async () => {
      const updated = await User.findOneAndUpdate({ _id: userId, role: { $in: ['customer', 'staff', 'delivery_partner'] } }, { $set: { role } }, { new: true, session })
        .select('phoneE164 name role status');
      if (!updated) throw new AppError(404, 'NOT_FOUND', 'Customer not found.');
      await AuditLog.create([{
        actorId,
        action: 'user.role_updated',
        resourceType: 'user',
        resourceId: updated.id,
        metadata: { role },
      }], { session });
      return updated;
    });
  } finally {
    await session.endSession();
  }
  if (!user) throw new AppError(500, 'INTERNAL_ERROR', 'The user role could not be updated.');
  sendData(res, user);
};

export const updateCustomerStatus: RequestHandler = async (req, res) => {
  const { userId } = z.object({ userId: z.string().regex(/^[a-f\d]{24}$/i) }).parse(req.params);
  const { status } = z.object({ status: z.enum(['active', 'disabled']) }).strict().parse(req.body);
  const actorId = authenticatedUserId(req);
  if (userId === actorId) throw new AppError(400, 'INVALID_REQUEST', 'You cannot disable your own account.');
  const update = status === 'disabled'
    ? { $set: { status }, $unset: { refreshTokenHash: 1 } }
    : { $set: { status } };
  const session = await mongoose.startSession();
  let user;
  try {
    user = await session.withTransaction(async () => {
      const updated = await User.findByIdAndUpdate(userId, update, { new: true, session })
        .select('phoneE164 name role status');
      if (!updated) throw new AppError(404, 'NOT_FOUND', 'User not found.');
      await AuditLog.create([{
        actorId,
        action: 'user.status_updated',
        resourceType: 'user',
        resourceId: updated.id,
        metadata: { status },
      }], { session });
      return updated;
    });
  } finally {
    await session.endSession();
  }
  if (!user) throw new AppError(500, 'INTERNAL_ERROR', 'The user status could not be updated.');
  sendData(res, user);
};

export const listDeliveryPartners: RequestHandler = async (req, res) => {
  const { page, limit } = pageSchema.parse(req.query);
  const [partners, total] = await Promise.all([
    User.find({ role: 'delivery_partner' }).select('phoneE164 name email role status createdAt').sort({ createdAt: -1 })
      .skip((page - 1) * limit).limit(limit).lean(),
    User.countDocuments({ role: 'delivery_partner' }),
  ]);
  const workloads = await Order.aggregate([
    { $match: { fulfilmentMethod: 'delivery', fulfilmentStatus: { $nin: ['delivered', 'completed', 'cancelled'] } } },
    { $group: { _id: '$deliveryPartner.userId', assignedCount: { $sum: 1 } } },
  ]);
  const workloadByPartner = new Map(workloads.map((workload) => [String(workload._id), workload.assignedCount]));
  const workload = partners.map((partner) => ({
    ...partner,
    assignedCount: workloadByPartner.get(String(partner._id)) ?? 0,
  }));
  sendPage(res, workload, page, limit, total);
};

export const getDeliveryPartner: RequestHandler = async (req, res) => {
  const { userId } = z.object({ userId: z.string().regex(/^[a-f\d]{24}$/i) }).parse(req.params);
  const { page, limit } = pageSchema.parse(req.query);
  const partner = await User.findOne({ _id: userId, role: 'delivery_partner' })
    .select('phoneE164 name email role status createdAt').lean();
  if (!partner) throw new AppError(404, 'NOT_FOUND', 'Delivery partner not found.');
  const filter = { 'deliveryPartner.userId': partner._id };
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);
  sendData(res, { partner, orders: { data: orders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
};

export const updateDeliveryPartnerStatus: RequestHandler = async (req, res) => {
  const { userId } = z.object({ userId: z.string().regex(/^[a-f\d]{24}$/i) }).parse(req.params);
  const { status } = z.object({ status: z.enum(['active', 'disabled']) }).strict().parse(req.body);
  const actorId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let partner;
  try {
    partner = await session.withTransaction(async () => {
      const updated = await User.findOneAndUpdate(
        { _id: userId, role: 'delivery_partner' },
        { $set: { status } },
        { new: true, session },
      ).select('phoneE164 name role status');
      if (!updated) throw new AppError(404, 'NOT_FOUND', 'Delivery partner not found.');
      await AuditLog.create([{
        actorId,
        action: 'delivery_partner.status_updated',
        resourceType: 'user',
        resourceId: updated.id,
        metadata: { status },
      }], { session });
      return updated;
    });
  } finally {
    await session.endSession();
  }
  sendData(res, partner);
};
