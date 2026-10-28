import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Order } from '../orders/order.model.js';
import { Product } from '../catalog/product.model.js';
import { User } from '../auth/user.model.js';
import { sendData, sendPage } from '../../utils/apiResponse.js';
import { AppError } from '../../utils/AppError.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { Settings } from '../settings/settings.model.js';

const terminalFulfilmentStatuses = ['delivered', 'completed', 'cancelled'] as const;
const overviewQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(30).default(30),
}).strict();

const orderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  paymentStatus: z.enum(['pending_verification', 'confirmed', 'rejected']).optional(),
  fulfilmentStatus: z.enum(['placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'completed', 'cancelled', 'delivery_failed']).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((query, context) => {
  if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
    context.addIssue({ code: 'custom', path: ['from'], message: '`from` must be earlier than or equal to `to`.' });
  }
});

export const getSuperAdminOverview: RequestHandler = async (req, res) => {
  const { days } = overviewQuerySchema.parse(req.query);
  const startDate = new Date();
  startDate.setUTCHours(0, 0, 0, 0);
  startDate.setUTCDate(startDate.getUTCDate() - days + 1);
  const [
    activeCustomers,
    activeDeliveryPartners,
    activeProducts,
    totalOrders,
    orderValue,
    pendingPayments,
    ordersNeedingAction,
    unassignedDeliveryOrders,
    lowStockProducts,
    lowStockVariants,
    ordersByFulfilmentStatus,
    dailyOrders,
    recentOrders,
  ] = await Promise.all([
    User.countDocuments({ role: 'customer', status: 'active' }),
    User.countDocuments({ role: 'delivery_partner', status: 'active' }),
    Product.countDocuments({ isActive: true, isArchived: false }),
    Order.countDocuments(),
    Order.aggregate([
      { $match: { fulfilmentStatus: { $ne: 'cancelled' } } },
      { $group: { _id: null, totalPaise: { $sum: '$totalPaise' } } },
    ]),
    Order.countDocuments({ paymentStatus: 'pending_verification' }),
    Order.countDocuments({ fulfilmentStatus: { $in: ['placed', 'accepted', 'preparing'] } }),
    Order.countDocuments({
      fulfilmentMethod: 'delivery',
      fulfilmentStatus: { $nin: terminalFulfilmentStatuses },
      'deliveryPartner.userId': { $exists: false },
    }),
    Product.countDocuments({
      isArchived: false,
      variants: { $size: 0 },
      $expr: { $lte: ['$stock', '$lowStockThreshold'] },
    }),
    Product.aggregate([
      { $match: { isArchived: false } },
      { $unwind: '$variants' },
      { $match: { $expr: { $lte: ['$variants.stock', '$lowStockThreshold'] } } },
      { $count: 'total' },
    ]),
    Order.aggregate([
      { $group: { _id: '$fulfilmentStatus', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Order.find()
      .sort({ createdAt: -1 })
      .limit(8)
      .select('customerId orderReference customerName address.city items.productName fulfilmentStatus paymentStatus paymentMethod totalPaise createdAt deliveryPartner.userId deliveryPartner.name')
      .lean(),
  ]);

  const countsByDay = new Map(dailyOrders.map(({ _id, count }) => [_id, count]));
  const ordersOverTime = Array.from({ length: days }, (_, index) => {
    const date = new Date(startDate);
    date.setUTCDate(startDate.getUTCDate() + index);
    const day = date.toISOString().slice(0, 10);
    return { day, count: countsByDay.get(day) ?? 0 };
  });

  sendData(res, {
    generatedAt: new Date().toISOString(),
    days,
    metrics: {
      activeCustomers,
      activeDeliveryPartners,
      activeProducts,
      totalOrders,
      orderValuePaise: orderValue[0]?.totalPaise ?? 0,
      pendingPayments,
      ordersNeedingAction,
      unassignedDeliveryOrders,
      lowStockItems: lowStockProducts + (lowStockVariants[0]?.total ?? 0),
    },
    ordersByFulfilmentStatus: ordersByFulfilmentStatus.map(({ _id, count }) => ({
      status: _id,
      count,
    })),
    ordersOverTime,
    recentOrders,
    unavailableModules: [
      'cities_and_zones',
      'city_administrators',
      'sellers_and_shgs',
      'financial_ledgers',
      'refunds',
      'settlements_and_payouts',
      'support_cases',
      'global_reports',
    ],
  });
};

export const listSuperAdminOrders: RequestHandler = async (req, res) => {
  const query = orderListQuerySchema.parse(req.query);
  const filter = {
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.fulfilmentStatus ? { fulfilmentStatus: query.fulfilmentStatus } : {}),
    ...(query.q ? {
      $or: [
        { orderReference: { $regex: escapeRegExp(query.q), $options: 'i' } },
        { customerName: { $regex: escapeRegExp(query.q), $options: 'i' } },
      ],
    } : {}),
    ...(query.from || query.to ? {
      createdAt: {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      },
    } : {}),
  };
  const [orders, total] = await Promise.all([
    Order.find(filter)
      .select('customerId orderReference customerName address.city items.productName fulfilmentStatus paymentStatus paymentMethod totalPaise createdAt deliveryPartner.userId deliveryPartner.name')
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Order.countDocuments(filter),
  ]);
  sendPage(res, orders, query.page, query.limit, total);
};

export const listSuperAdminCities: RequestHandler = async (_req, res) => {
  const [settings, assignedCities, orderCities] = await Promise.all([
    Settings.findOne({ key: 'global' }).select('city state serviceableLocalities').lean(),
    User.distinct('assignedCity', { assignedCity: { $type: 'string', $ne: '' } }),
    Order.distinct('address.city', { 'address.city': { $type: 'string', $ne: '' } }),
  ]);
  const cityNames = [...new Map(
    [...assignedCities, ...orderCities, ...(settings?.city ? [settings.city] : [])]
      .filter((city): city is string => typeof city === 'string' && Boolean(city.trim()))
      .map((city) => [city.trim().toLocaleLowerCase(), city.trim()]),
  ).values()].sort((left, right) => left.localeCompare(right));

  const cities = await Promise.all(cityNames.map(async (city) => {
    const cityPattern = new RegExp(`^${escapeRegExp(city)}$`, 'i');
    const [cityAdmins, sellerCount, orderCount, currentPartnerIds, historicalPartnerIds] = await Promise.all([
      User.find({ role: 'city_admin', assignedCity: cityPattern }).select('name').sort({ createdAt: 1 }).lean(),
      User.countDocuments({ role: 'seller', assignedCity: cityPattern }),
      Order.countDocuments({ 'address.city': cityPattern }),
      Order.distinct('deliveryPartner.userId', { 'address.city': cityPattern, 'deliveryPartner.userId': { $exists: true } }),
      Order.distinct('deliveryPartnerHistory.userId', { 'address.city': cityPattern }),
    ]);
    const partnerIds = [...new Set([...currentPartnerIds, ...historicalPartnerIds].filter(Boolean).map(String))];
    const deliveryPartnerCount = partnerIds.length
      ? await User.countDocuments({ _id: { $in: partnerIds }, role: 'delivery_partner' })
      : 0;
    const isConfigured = settings?.city.toLocaleLowerCase() === city.toLocaleLowerCase();
    return {
      city,
      state: isConfigured ? settings.state : undefined,
      configured: isConfigured,
      cityAdminName: cityAdmins.find((admin) => admin.name)?.name ?? null,
      cityAdminCount: cityAdmins.length,
      sellerCount,
      deliveryPartnerCount,
      orderCount,
      serviceZoneCount: isConfigured ? settings.serviceableLocalities.length : 0,
    };
  }));
  sendData(res, cities);
};

export const getSuperAdminCity: RequestHandler = async (req, res) => {
  const { city } = z.object({ city: z.string().trim().min(1).max(100) }).strict().parse(req.params);
  const cityPattern = new RegExp(`^${escapeRegExp(city)}$`, 'i');
  const [settings, cityAdmins, sellers, orderCount, recentOrders, currentPartnerIds, historicalPartnerIds] = await Promise.all([
    Settings.findOne({ key: 'global' }).select('city state serviceableLocalities').lean(),
    User.find({ role: 'city_admin', assignedCity: cityPattern }).select('name phoneE164 email assignedCity status createdAt').sort({ createdAt: -1 }).lean(),
    User.find({ role: 'seller', assignedCity: cityPattern }).select('name phoneE164 email assignedCity status createdAt').sort({ createdAt: -1 }).lean(),
    Order.countDocuments({ 'address.city': cityPattern }),
    Order.find({ 'address.city': cityPattern })
      .select('customerId orderReference customerName address.city items.productName fulfilmentStatus paymentStatus paymentMethod totalPaise createdAt deliveryPartner.userId deliveryPartner.name')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
    Order.distinct('deliveryPartner.userId', { 'address.city': cityPattern, 'deliveryPartner.userId': { $exists: true } }),
    Order.distinct('deliveryPartnerHistory.userId', { 'address.city': cityPattern }),
  ]);
  const partnerIds = [...new Set([...currentPartnerIds, ...historicalPartnerIds].filter(Boolean).map(String))];
  const deliveryPartners = partnerIds.length
    ? await User.find({ _id: { $in: partnerIds }, role: 'delivery_partner' })
      .select('name phoneE164 email status createdAt')
      .sort({ createdAt: -1 })
      .lean()
    : [];
  const isConfigured = settings?.city.toLocaleLowerCase() === city.toLocaleLowerCase();
  sendData(res, {
    city,
    state: isConfigured ? settings.state : undefined,
    configured: isConfigured,
    serviceableLocalities: isConfigured ? settings.serviceableLocalities : [],
    cityAdmins,
    sellers,
    deliveryPartners,
    metrics: {
      cityAdmins: cityAdmins.length,
      sellers: sellers.length,
      deliveryPartners: deliveryPartners.length,
      orders: orderCount,
      serviceZones: isConfigured ? settings.serviceableLocalities.length : 0,
    },
    recentOrders,
  });
};

const cityAdminListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const normalizedPhoneSchema = z.string().trim().transform((value) => {
  const compact = value.replace(/[\s()-]/g, '');
  if (/^[6-9]\d{9}$/.test(compact)) return `+91${compact}`;
  if (/^\+91[6-9]\d{9}$/.test(compact)) return compact;
  return compact;
}).pipe(z.string().regex(/^\+91[6-9]\d{9}$/, 'Enter a valid Indian mobile number.'));

const cityAdminCreateSchema = z.object({
  phone: normalizedPhoneSchema,
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(254).optional(),
  city: z.string().trim().min(1).max(100).optional(),
}).strict();

const cityAdminUpdateSchema = z.object({
  city: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(254).optional(),
  status: z.enum(['active', 'disabled']).optional(),
}).strict();

export const getSuperAdminCityAdmins: RequestHandler = async (req, res) => {
  const query = cityAdminListQuerySchema.parse(req.query);
  const [admins, total] = await Promise.all([
    User.find({ role: 'city_admin' })
      .select('name phoneE164 email assignedCity status createdAt')
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    User.countDocuments({ role: 'city_admin' }),
  ]);
  sendPage(res, admins, query.page, query.limit, total);
};

export const getSuperAdminCityAdmin: RequestHandler = async (req, res) => {
  const { userId } = z.object({ userId: z.string().regex(/^[a-f\d]{24}$/i) }).strict().parse(req.params);
  const admin = await User.findOne({ _id: userId, role: 'city_admin' })
    .select('name phoneE164 email assignedCity status createdAt')
    .lean();
  if (!admin) throw new AppError(404, 'NOT_FOUND', 'City Admin not found.');
  sendData(res, admin);
};

export const createSuperAdminCityAdmin: RequestHandler = async (req, res) => {
  const input = cityAdminCreateSchema.parse(req.body);
  const actorId = authenticatedUserId(req);
  const settings = await Settings.findOne({ key: 'global' }).select('city').lean();
  const assignedCity = input.city?.trim() || settings?.city?.trim() || 'Damoh';
  const session = await mongoose.startSession();
  let admin;
  try {
    admin = await session.withTransaction(async () => {
      const existing = await User.findOne({ phoneE164: input.phone }).session(session);
      if (existing && existing.status !== 'active') {
        throw new AppError(409, 'ACCOUNT_DISABLED', 'This account is disabled. Restore it before assigning a City Admin role.');
      }
      if (existing && existing.role !== 'customer' && existing.role !== 'city_admin') {
        throw new AppError(409, 'ROLE_ALREADY_ASSIGNED', 'This account already has a different operational role and cannot be assigned as City Admin.');
      }
      if (existing && existing.role === 'city_admin' && existing.assignedCity && existing.assignedCity !== assignedCity) {
        throw new AppError(409, 'CITY_ADMIN_ALREADY_ASSIGNED', 'This person is already assigned to another city and cannot be assigned again.');
      }
      const existingCityAdmin = await User.findOne({
        role: 'city_admin',
        assignedCity,
        _id: { $ne: existing?._id ?? null },
      }).session(session);
      if (existingCityAdmin) {
        throw new AppError(409, 'CITY_ALREADY_ASSIGNED', 'This city already has an assigned City Admin.');
      }
      const user = await User.findOneAndUpdate(
        { phoneE164: input.phone },
        {
          $set: {
            role: 'city_admin',
            assignedCity,
            status: 'active',
            ...(input.name ? { name: input.name.trim() } : {}),
            ...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
          },
          $setOnInsert: { phoneE164: input.phone },
        },
        { upsert: true, new: true, session, runValidators: true, setDefaultsOnInsert: true },
      );
      if (!user) throw new AppError(500, 'INTERNAL_ERROR', 'The City Admin could not be created.');
      await AuditLog.create([{
        actorId,
        action: 'user.city_admin_provisioned',
        resourceType: 'user',
        resourceId: String(user.id),
        metadata: { role: 'city_admin', assignedCity, phoneE164: input.phone },
      }], { session });
      return user;
    });
  } finally {
    await session.endSession();
  }
  sendData(res, admin);
};

export const updateSuperAdminCityAdmin: RequestHandler = async (req, res) => {
  const { userId } = z.object({ userId: z.string().regex(/^[a-f\d]{24}$/i) }).parse(req.params);
  const input = cityAdminUpdateSchema.parse(req.body);
  const actorId = authenticatedUserId(req);
  const current = await User.findById(userId).lean();
  if (!current || current.role !== 'city_admin') {
    throw new AppError(404, 'NOT_FOUND', 'City Admin not found.');
  }
  if (input.city && current.assignedCity && current.assignedCity !== input.city) {
    const duplicate = await User.findOne({ role: 'city_admin', assignedCity: input.city, _id: { $ne: userId } }).lean();
    if (duplicate) {
      throw new AppError(409, 'CITY_ALREADY_ASSIGNED', 'This city is already assigned to another City Admin.');
    }
  }
  const nextCity = input.city?.trim() || current.assignedCity;
  const updates: Record<string, unknown> = {
    ...(input.name ? { name: input.name.trim() } : {}),
    ...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
    ...(typeof input.status !== 'undefined' ? { status: input.status } : {}),
    ...(nextCity ? { assignedCity: nextCity } : {}),
  };
  const updated = await User.findByIdAndUpdate(userId, { $set: updates }, { new: true }).select('name phoneE164 email assignedCity status createdAt').lean();
  if (!updated) throw new AppError(500, 'INTERNAL_ERROR', 'The City Admin could not be updated.');
  await AuditLog.create([{ actorId, action: 'user.city_admin_updated', resourceType: 'user', resourceId: String(updated._id), metadata: { assignedCity: updated.assignedCity, status: updated.status } }]);
  sendData(res, updated);
};

export const getSuperAdminSellers: RequestHandler = async (req, res) => {
  const query = cityAdminListQuerySchema.parse(req.query);
  const [sellers, total] = await Promise.all([
    User.find({ role: 'seller' })
      .select('name phoneE164 email assignedCity status createdAt')
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    User.countDocuments({ role: 'seller' }),
  ]);
  sendPage(res, sellers, query.page, query.limit, total);
};

export const getSuperAdminSeller: RequestHandler = async (req, res) => {
  const { userId } = z.object({ userId: z.string().regex(/^[a-f\d]{24}$/i) }).strict().parse(req.params);
  const seller = await User.findOne({ _id: userId, role: 'seller' })
    .select('name phoneE164 email assignedCity status createdAt')
    .lean();
  if (!seller) throw new AppError(404, 'NOT_FOUND', 'Seller not found.');
  sendData(res, seller);
};

const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const listSuperAdminAuditLogs: RequestHandler = async (req, res) => {
  const query = auditLogQuerySchema.parse(req.query);
  const [logs, total] = await Promise.all([
    AuditLog.find()
      .populate({ path: 'actorId', select: 'name role phoneE164' })
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    AuditLog.countDocuments(),
  ]);
  sendPage(res, logs, query.page, query.limit, total);
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
