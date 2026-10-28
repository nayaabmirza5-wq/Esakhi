import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../../utils/AppError.js';
import { sendData, sendPage } from '../../utils/apiResponse.js';
import { Order } from '../orders/order.model.js';

const orderQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  fulfilmentStatus: z.enum(['placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'completed', 'cancelled', 'delivery_failed']).optional(),
  paymentStatus: z.enum(['pending_verification', 'confirmed', 'rejected']).optional(),
  unassignedOnly: z.enum(['true', 'false']).optional(),
}).strict();

const terminalStatuses = ['delivered', 'completed', 'cancelled'] as const;
const activeAssignmentStatuses = ['placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivery_failed'] as const;
const cityTimeZone = '+05:30';

function cityScope(req: Parameters<RequestHandler>[0]): string {
  const city = req.user?.assignedCity?.trim();
  if (!city) {
    throw new AppError(403, 'CITY_SCOPE_REQUIRED', 'This City Admin account has no assigned city.');
  }
  return city;
}

function cityFilter(city: string): RegExp {
  return new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

export const getCityAdminDashboard: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const scope = { 'address.city': cityFilter(city) };
  const today = startOfCityDay();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const chartStart = new Date(today);
  chartStart.setUTCDate(chartStart.getUTCDate() - 6);
  const [
    todayOrders,
    awaitingAssignment,
    outForDelivery,
    deliveredToday,
    ordersNeedingAction,
    paymentsToReview,
    ordersByStatus,
    dailyOrders,
    recentOrders,
    assignmentExceptions,
  ] = await Promise.all([
    Order.countDocuments({ ...scope, createdAt: { $gte: today, $lt: tomorrow } }),
    Order.countDocuments({
      ...scope,
      fulfilmentMethod: 'delivery',
      fulfilmentStatus: { $in: activeAssignmentStatuses },
      'deliveryPartner.name': { $exists: false },
    }),
    Order.countDocuments({ ...scope, fulfilmentStatus: 'out_for_delivery' }),
    Order.aggregate([
      { $match: { ...scope, fulfilmentStatus: { $in: ['delivered', 'completed'] } } },
      { $project: { currentStatus: { $arrayElemAt: ['$statusHistory', -1] } } },
      { $match: { 'currentStatus.changedAt': { $gte: today, $lt: tomorrow } } },
      { $count: 'total' },
    ]),
    Order.countDocuments({ ...scope, fulfilmentStatus: { $in: ['placed', 'accepted', 'preparing'] } }),
    Order.countDocuments({ ...scope, paymentStatus: 'pending_verification' }),
    Order.aggregate([
      { $match: { ...scope, createdAt: { $gte: today, $lt: tomorrow } } },
      { $group: { _id: '$fulfilmentStatus', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate([
      { $match: { ...scope, createdAt: { $gte: chartStart, $lt: tomorrow } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: cityTimeZone } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Order.find(scope)
      .sort({ createdAt: -1 })
      .limit(6)
      .select('orderReference customerName items.productName totalPaise paymentMethod paymentStatus fulfilmentStatus deliveryPartner.name address.locality createdAt')
      .lean(),
    Order.find({
      ...scope,
      fulfilmentMethod: 'delivery',
      fulfilmentStatus: { $in: activeAssignmentStatuses },
      'deliveryPartner.name': { $exists: false },
    })
      .sort({ createdAt: 1 })
      .limit(5)
      .select('orderReference address.locality fulfilmentStatus createdAt')
      .lean(),
  ]);
  const dailyCounts = new Map(dailyOrders.map(({ _id, count }) => [_id, count]));
  const ordersOverTime = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(chartStart);
    date.setUTCDate(chartStart.getUTCDate() + index);
    const day = new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    return { day, count: dailyCounts.get(day) ?? 0 };
  });

  sendData(res, {
    city,
    generatedAt: new Date().toISOString(),
    metrics: {
      todayOrders,
      awaitingAssignment,
      outForDelivery,
      deliveredToday: deliveredToday[0]?.total ?? 0,
      ordersNeedingAction,
      paymentsToReview,
    },
    ordersByStatus: ordersByStatus.map(({ _id, count }) => ({ status: _id, count })),
    ordersOverTime,
    recentOrders,
    assignmentExceptions,
    unavailableMetrics: ['active_delivery_partners', 'partner_applications', 'seller_reviews', 'support_tickets', 'inventory_by_city'],
  });
};

function startOfCityDay(now = new Date()): Date {
  const cityDate = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(cityDate.getUTCFullYear(), cityDate.getUTCMonth(), cityDate.getUTCDate()) - 330 * 60_000);
}

export const listCityAdminOrders: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const query = orderQuerySchema.parse(req.query);
  const orderQuery = Order.find({ 'address.city': cityFilter(city) });
  const countQuery = Order.countDocuments({ 'address.city': cityFilter(city) });
  if (query.fulfilmentStatus) orderQuery.where('fulfilmentStatus').equals(query.fulfilmentStatus);
  if (query.paymentStatus) orderQuery.where('paymentStatus').equals(query.paymentStatus);
  if (query.fulfilmentStatus) countQuery.where('fulfilmentStatus').equals(query.fulfilmentStatus);
  if (query.paymentStatus) countQuery.where('paymentStatus').equals(query.paymentStatus);
  if (query.unassignedOnly === 'true') {
    orderQuery.where('fulfilmentMethod').equals('delivery');
    orderQuery.where('fulfilmentStatus').in([...activeAssignmentStatuses]);
    orderQuery.where('deliveryPartner.name').exists(false);
    countQuery.where('fulfilmentMethod').equals('delivery');
    countQuery.where('fulfilmentStatus').in([...activeAssignmentStatuses]);
    countQuery.where('deliveryPartner.name').exists(false);
  }
  if (query.q) {
    const search = escapeRegExp(query.q);
    const searchConditions = [
      { orderReference: { $regex: search, $options: 'i' } },
      { customerName: { $regex: search, $options: 'i' } },
    ];
    orderQuery.or(searchConditions);
    countQuery.or(searchConditions);
  }
  const [orders, total] = await Promise.all([
    orderQuery
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .select('orderReference customerName items.productName totalPaise paymentMethod paymentStatus fulfilmentStatus deliveryPartner.name address.locality createdAt')
      .lean(),
    countQuery,
  ]);
  sendPage(res, orders, query.page, query.limit, total);
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
