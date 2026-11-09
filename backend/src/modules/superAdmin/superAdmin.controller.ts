import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { FULFILMENT_STATUS_ENUM, Order } from '../orders/order.model.js';
import { PenaltyLedger } from '../orders/penaltyLedger.model.js';
import { resolveOrderSellerPickup } from '../orders/order.controller.js';
import { Product } from '../catalog/product.model.js';
import { User } from '../auth/user.model.js';
import { Seller } from '../../models/Seller.js';
import { sendData, sendPage } from '../../utils/apiResponse.js';
import { AppError } from '../../utils/AppError.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { Settings } from '../settings/settings.model.js';

const terminalFulfilmentStatuses = ['delivered', 'completed', 'cancelled', 'refund_completed'] as const;
const overviewQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(30).default(30),
}).strict();

const orderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  paymentStatus: z.enum(['pending_verification', 'confirmed', 'rejected', 'refunded']).optional(),
  fulfilmentStatus: z.enum([...FULFILMENT_STATUS_ENUM]).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((query, context) => {
  if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
    context.addIssue({ code: 'custom', path: ['from'], message: '`from` must be earlier than or equal to `to`.' });
  }
});

async function enrichOrdersForSuperAdmin(orders: Array<Record<string, unknown>>) {
  const cityAdmins = await User.find({ role: 'city_admin' })
    .select('_id name phoneE164 email assignedCity')
    .lean();
  const cityAdminByCity = new Map(
    cityAdmins
      .filter((admin) => admin.assignedCity)
      .map((admin) => [String(admin.assignedCity).toLocaleLowerCase(), admin]),
  );

  return Promise.all(orders.map(async (order) => {
    const sellerPickup = await resolveOrderSellerPickup(order as Parameters<typeof resolveOrderSellerPickup>[0]);
    const addressObj = order.address as { city?: string } | undefined;
    const city = addressObj?.city || sellerPickup.city || 'Damoh';
    const cityAdmin = cityAdminByCity.get(city.toLocaleLowerCase()) ?? cityAdmins[0];
    return {
      ...order,
      sellerPickup,
      sellerDetails: {
        sellerId: sellerPickup.sellerId,
        sellerName: sellerPickup.sellerName,
        phoneE164: sellerPickup.phoneE164,
        address: sellerPickup.address,
        city: sellerPickup.city,
      },
      cityAdminDetails: cityAdmin
        ? {
          _id: String(cityAdmin._id),
          name: cityAdmin.name || 'City Admin',
          phoneE164: cityAdmin.phoneE164,
          email: cityAdmin.email,
          assignedCity: cityAdmin.assignedCity || city,
        }
        : {
          name: `${city} City Admin`,
          assignedCity: city,
        },
    };
  }));
}

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
    recentOrdersRaw,
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
    Order.countDocuments({
      fulfilmentStatus: {
        $in: ['placed', 'order_confirmed', 'accepted', 'preparing', 'ready_for_pickup', 'ready_for_refund'],
      },
    }),
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
      .select('customerId orderReference customerName address.city items.productName items.sellerId sellerPickup fulfilmentStatus paymentStatus paymentMethod totalPaise createdAt updatedAt statusHistory deliveryPartner.userId deliveryPartner.name deliveryPartner.phoneE164 deliveryPartner.assignedAt preDispatchInspection returnRequest')
      .lean(),
  ]);

  const recentOrders = await enrichOrdersForSuperAdmin(recentOrdersRaw as unknown as Array<Record<string, unknown>>);

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
  const [ordersRaw, total] = await Promise.all([
    Order.find(filter)
      .select('customerId orderReference customerName address.city items.productName items.sellerId sellerPickup fulfilmentStatus paymentStatus paymentMethod totalPaise createdAt updatedAt statusHistory deliveryPartner.userId deliveryPartner.name deliveryPartner.phoneE164 deliveryPartner.assignedAt preDispatchInspection returnRequest')
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Order.countDocuments(filter),
  ]);
  const orders = await enrichOrdersForSuperAdmin(ordersRaw as unknown as Array<Record<string, unknown>>);
  sendPage(res, orders, query.page, query.limit, total);
};

export const processSuperAdminOrderRefund: RequestHandler = async (req, res) => {
  const { orderId } = z.object({ orderId: z.string().regex(/^[a-f\d]{24}$/i) }).strict().parse(req.params);
  const { note } = z.object({ note: z.string().trim().max(500).optional() }).strict().parse(req.body ?? {});
  const actorId = authenticatedUserId(req);

  const order = await Order.findById(orderId);
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
  if (!['ready_for_refund', 'return_delivered_to_seller', 'return_accepted'].includes(order.fulfilmentStatus) || !order.returnRequest) {
    throw new AppError(
      409,
      'REFUND_NOT_READY',
      'Order must be in READY_FOR_REFUND (or RETURN_DELIVERED_TO_SELLER) status to disburse refund.',
    );
  }

  const customer = await User.findById(order.customerId).select('name phoneE164 bankAccount').lean();
  const bank = customer?.bankAccount;
  const rawAccNum = bank?.accountNumber || '00001234';
  const maskedAccount =
    rawAccNum.length > 4 ? `${'*'.repeat(Math.max(4, rawAccNum.length - 4))}${rawAccNum.slice(-4)}` : rawAccNum;
  const txRef = `RFND-${Date.now().toString(36).toUpperCase()}-${order.orderReference.slice(-4)}`;

  const returnFeeDeductionPaise = (
    order.returnRequest.reasonCode === 'changed_mind' ||
    order.returnRequest.arbitration?.faultAttribution === 'no_fault'
  ) ? 3500 : 0;
  const actualRefundPaise = Math.max(0, order.totalPaise - returnFeeDeductionPaise);

  order.fulfilmentStatus = 'refund_completed';
  order.paymentStatus = 'refunded';
  order.returnRequest.status = 'refund_completed';
  order.returnRequest.refund = {
    refundAmountPaise: actualRefundPaise,
    deductionAmountPaise: returnFeeDeductionPaise,
    deductionNote: returnFeeDeductionPaise > 0
      ? 'Reverse pickup logistics fee (\u20b935) deducted for discretionary return.'
      : 'Full 100% refund disbursed with zero deductions.',

    bankAccountHolderName: bank?.accountHolderName || order.customerName,
    bankAccountNumberMasked: maskedAccount,
    bankName: bank?.bankName || 'Linked Customer Bank',
    ifscCode: bank?.ifscCode || 'SBIN0000001',
    ...(bank?.upiId ? { upiId: bank.upiId } : {}),
    transactionReference: txRef,
    processedBy: new mongoose.Types.ObjectId(actorId),
    processedAt: new Date(),
  };

  order.statusHistory.push({
    status: 'refund_completed',
    changedAt: new Date(),
    actorType: 'user',
    actorId: new mongoose.Types.ObjectId(actorId),
    note:
      note ||
      `REFUND_COMPLETED: Super Admin disbursed ₹${(order.totalPaise / 100).toFixed(2)} to Customer's linked bank account (${bank?.bankName || 'Bank'} ${maskedAccount}, Ref: ${txRef}).`,
  });

  order.paymentEvents.push({
    status: 'refunded',
    actorId: new mongoose.Types.ObjectId(actorId),
    note: `Refund disbursed to linked bank account (${maskedAccount}). Transaction Ref: ${txRef}`,
    createdAt: new Date(),
  });

  if (order.returnRequest.arbitration?.penaltyLedgerId) {
    await PenaltyLedger.updateOne(
      { _id: order.returnRequest.arbitration.penaltyLedgerId },
      { $set: { settlementStatus: 'SETTLED', settledAt: new Date() } },
    );
  }

  await order.save();
  await AuditLog.create({
    actorId,
    action: 'order.refund_completed_by_super_admin',
    resourceType: 'order',
    resourceId: String(order._id),
    metadata: {
      orderReference: order.orderReference,
      refundAmountPaise: order.totalPaise,
      transactionReference: txRef,
    },
  });

  const enriched = await enrichOrdersForSuperAdmin([order.toObject() as unknown as Record<string, unknown>]);
  sendData(res, enriched[0]);
};

export const settleSuperAdminPenalty: RequestHandler = async (req, res) => {
  const { penaltyId } = z.object({ penaltyId: z.string().regex(/^[a-f\d]{24}$/i) }).strict().parse(req.params);
  const actorId = authenticatedUserId(req);

  const penalty = await PenaltyLedger.findByIdAndUpdate(
    penaltyId,
    { $set: { settlementStatus: 'SETTLED', settledAt: new Date() } },
    { new: true },
  ).lean();

  if (!penalty) throw new AppError(404, 'NOT_FOUND', 'Penalty ledger record not found.');
  await AuditLog.create({
    actorId,
    action: 'penalty.settled_in_monthly_payout',
    resourceType: 'penalty_ledger',
    resourceId: String(penalty._id),
    metadata: {
      orderReference: penalty.orderReference,
      partyType: penalty.partyType,
      penaltyAmountPaise: penalty.penaltyAmountPaise,
    },
  });

  sendData(res, penalty);
};

export const getSuperAdminSettlementsLedger: RequestHandler = async (_req, res) => {
  const [allOrdersRaw, penaltiesRaw, sellers, partners, customers] = await Promise.all([
    Order.find({ fulfilmentStatus: { $ne: 'cancelled' } })
      .select('customerId orderReference customerName customerPhoneE164 address items subtotalPaise deliveryFeePaise totalPaise paymentMethod paymentStatus fulfilmentStatus sellerPickup deliveryPartner preDispatchInspection returnRequest statusHistory createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .lean(),
    PenaltyLedger.find().sort({ createdAt: -1 }).lean(),
    User.find({ role: 'seller' }).select('_id name phoneE164 assignedCity').lean(),
    User.find({ role: 'delivery_partner' }).select('_id name phoneE164 assignedCity').lean(),
    User.find({ role: 'customer' }).select('_id name phoneE164 bankAccount').lean(),
  ]);

  const customerMap = new Map(customers.map((c) => [String(c._id), c]));
  const sellerMap = new Map(sellers.map((s) => [String(s._id), s]));
  const partnerMap = new Map(partners.map((p) => [String(p._id), p]));

  const grossSalesPaise = allOrdersRaw.reduce((sum, o) => sum + (o.subtotalPaise ?? 0), 0);
  const platformCommissionsPaise = Math.round(grossSalesPaise * 0.1);
  const activePenaltiesPaise = penaltiesRaw
    .filter((p) => p.settlementStatus === 'SELLER_PENALTY_PENDING' || p.settlementStatus === 'DELIVERY_PARTNER_PENALTY_PENDING')
    .reduce((sum, p) => sum + (p.penaltyAmountPaise ?? 0), 0);
  const settledPenaltiesPaise = penaltiesRaw
    .filter((p) => p.settlementStatus === 'SETTLED')
    .reduce((sum, p) => sum + (p.penaltyAmountPaise ?? 0), 0);
  const totalPenaltiesPaise = activePenaltiesPaise + settledPenaltiesPaise;

  const pendingRefundOrdersRaw = allOrdersRaw.filter((o) =>
    ['ready_for_refund', 'return_delivered_to_seller'].includes(o.fulfilmentStatus),
  );
  const completedRefundOrdersRaw = allOrdersRaw.filter((o) => o.fulfilmentStatus === 'refund_completed');
  const totalRefundsDisbursedPaise = completedRefundOrdersRaw.reduce((sum, o) => sum + (o.totalPaise ?? 0), 0);

  // Seller Settlements Breakdown
  const sellerGrossBySellerId = new Map<string, number>();
  for (const order of allOrdersRaw) {
    for (const item of order.items ?? []) {
      if (item.sellerId) {
        const sid = String(item.sellerId);
        sellerGrossBySellerId.set(sid, (sellerGrossBySellerId.get(sid) ?? 0) + (item.lineTotalPaise ?? 0));
      }
    }
  }

  const sellerIdsSet = new Set<string>([
    ...sellers.map((s) => String(s._id)),
    ...sellerGrossBySellerId.keys(),
    ...penaltiesRaw.filter((p) => p.partyType === 'seller').map((p) => String(p.partyId)),
  ]);

  const sellerSettlements = [...sellerIdsSet].map((sellerId) => {
    const sellerDoc = sellerMap.get(sellerId);
    const grossPaise = sellerGrossBySellerId.get(sellerId) ?? 0;
    const commissionPaise = Math.round(grossPaise * 0.1);
    const sellerPenalties = penaltiesRaw.filter(
      (p) => p.partyType === 'seller' && String(p.partyId) === sellerId && p.settlementStatus !== 'WAIVED',
    );
    const penaltyDeductionsPaise = sellerPenalties.reduce((sum, p) => sum + (p.penaltyAmountPaise ?? 0), 0);
    const netSettlementPaise = Math.max(0, grossPaise - commissionPaise - penaltyDeductionsPaise);
    return {
      sellerId,
      sellerName: sellerDoc?.name || sellerPenalties[0]?.partyName || 'SHG Seller',
      phoneE164: sellerDoc?.phoneE164 || '',
      city: sellerDoc?.assignedCity || 'Damoh',
      grossMonthlyPayoutPaise: grossPaise,
      platformCommissionPaise: commissionPaise,
      penaltyDeductionsPaise,
      netSettlementPaise,
      penalties: sellerPenalties.map((p) => ({
        _id: String(p._id),
        orderId: String(p.orderId),
        orderReference: p.orderReference,
        penaltyAmountPaise: p.penaltyAmountPaise,
        reason: p.reason,
        settlementStatus: p.settlementStatus,
        createdAt: p.createdAt,
      })),
    };
  });

  // Delivery Partner Settlements Breakdown
  const partnerGrossByPartnerId = new Map<string, { grossPaise: number; tripsCount: number }>();
  for (const order of allOrdersRaw) {
    if (
      order.deliveryPartner?.userId &&
      ['delivered', 'completed', 'return_delivered_to_seller', 'ready_for_refund', 'refund_completed'].includes(
        order.fulfilmentStatus,
      )
    ) {
      const pid = String(order.deliveryPartner.userId);
      const current = partnerGrossByPartnerId.get(pid) ?? { grossPaise: 0, tripsCount: 0 };
      const fee = (order.deliveryFeePaise && order.deliveryFeePaise > 0 ? order.deliveryFeePaise : 4500) +
        (['return_delivered_to_seller', 'ready_for_refund', 'refund_completed'].includes(order.fulfilmentStatus) ? 3500 : 0);
      partnerGrossByPartnerId.set(pid, {
        grossPaise: current.grossPaise + fee,
        tripsCount: current.tripsCount + 1,
      });
    }
  }

  const partnerIdsSet = new Set<string>([
    ...partners.map((p) => String(p._id)),
    ...partnerGrossByPartnerId.keys(),
    ...penaltiesRaw.filter((p) => p.partyType === 'delivery_partner').map((p) => String(p.partyId)),
  ]);

  const deliveryPartnerSettlements = [...partnerIdsSet].map((partnerId) => {
    const partnerDoc = partnerMap.get(partnerId);
    const stats = partnerGrossByPartnerId.get(partnerId) ?? { grossPaise: 0, tripsCount: 0 };
    const partnerPenalties = penaltiesRaw.filter(
      (p) => p.partyType === 'delivery_partner' && String(p.partyId) === partnerId && p.settlementStatus !== 'WAIVED',
    );
    const penaltyDeductionsPaise = partnerPenalties.reduce((sum, p) => sum + (p.penaltyAmountPaise ?? 0), 0);
    const netSettlementPaise = Math.max(0, stats.grossPaise - penaltyDeductionsPaise);
    return {
      partnerId,
      partnerName: partnerDoc?.name || partnerPenalties[0]?.partyName || 'Delivery Partner',
      phoneE164: partnerDoc?.phoneE164 || '',
      city: partnerDoc?.assignedCity || 'Damoh',
      tripsCount: stats.tripsCount,
      grossDeliveryEarningsPaise: stats.grossPaise,
      penaltyDeductionsPaise,
      netSettlementPaise,
      penalties: partnerPenalties.map((p) => ({
        _id: String(p._id),
        orderId: String(p.orderId),
        orderReference: p.orderReference,
        penaltyAmountPaise: p.penaltyAmountPaise,
        reason: p.reason,
        settlementStatus: p.settlementStatus,
        createdAt: p.createdAt,
      })),
    };
  });

  const finalNetPayoutsPaise =
    sellerSettlements.reduce((sum, s) => sum + s.netSettlementPaise, 0) +
    deliveryPartnerSettlements.reduce((sum, p) => sum + p.netSettlementPaise, 0);

  sendData(res, {
    monthLabel: new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
    summary: {
      grossSalesPaise,
      platformCommissionsPaise,
      activePenaltiesPaise,
      settledPenaltiesPaise,
      totalPenaltiesPaise,
      pendingRefundsCount: pendingRefundOrdersRaw.length,
      totalRefundsDisbursedPaise,
      finalNetPayoutsPaise,
    },
    pendingRefundOrders: pendingRefundOrdersRaw.map((o) => {
      const cust = customerMap.get(String(o.customerId));
      return {
        _id: String(o._id),
        orderReference: o.orderReference,
        customerName: o.customerName,
        customerPhoneE164: o.customerPhoneE164,
        totalPaise: o.totalPaise,
        fulfilmentStatus: o.fulfilmentStatus,
        paymentMethod: o.paymentMethod,
        bankAccount: cust?.bankAccount ?? {
          accountHolderName: o.customerName,
          accountNumber: 'XXXX1234',
          ifscCode: 'SBIN0000001',
          bankName: 'Linked Customer Bank',
          verified: true,
        },
        returnRequest: o.returnRequest,
        updatedAt: o.updatedAt,
      };
    }),
    completedRefundOrders: completedRefundOrdersRaw.map((o) => ({
      _id: String(o._id),
      orderReference: o.orderReference,
      customerName: o.customerName,
      totalPaise: o.totalPaise,
      fulfilmentStatus: o.fulfilmentStatus,
      refund: o.returnRequest?.refund,
      updatedAt: o.updatedAt,
    })),
    penaltyLedger: penaltiesRaw.map((p) => ({
      _id: String(p._id),
      orderId: String(p.orderId),
      orderReference: p.orderReference,
      city: p.city,
      partyType: p.partyType,
      partyId: String(p.partyId),
      partyName: p.partyName,
      penaltyAmountPaise: p.penaltyAmountPaise,
      reason: p.reason,
      faultType: p.faultType,
      cityAdminId: String(p.cityAdminId),
      settlementStatus: p.settlementStatus,
      createdAt: p.createdAt,
      settledAt: p.settledAt,
    })),
    sellerSettlements,
    deliveryPartnerSettlements,
  });
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
  const sellerIds = sellers.map((s) => s._id);
  const sellerDocs = await Seller.find({ userId: { $in: sellerIds } } as any).lean();
  const sellerDocMap = new Map((sellerDocs as any[]).map((s) => [String(s.userId), s]));
  const enriched = sellers.map((seller: any) => {
    const profile = sellerDocMap.get(String(seller._id)) as any;
    return {
      ...seller,
      name: profile?.supplierDetails?.shgName || seller.name || 'Seller',
      shgName: profile?.supplierDetails?.shgName,
      shgLeaderName: profile?.supplierDetails?.shgLeaderName,
      category: profile?.supplierDetails?.category,
      verificationStatus: profile?.status === 'ACTIVE' ? 'verified' : 'verified',
      sellerProfile: profile,
    };
  });
  sendPage(res, enriched, query.page, query.limit, total);
};

export const getSuperAdminSeller: RequestHandler = async (req, res) => {
  const { userId } = z.object({ userId: z.string().regex(/^[a-f\d]{24}$/i) }).strict().parse(req.params);
  const seller = await User.findOne({ _id: userId, role: 'seller' })
    .select('name phoneE164 email assignedCity status createdAt')
    .lean();
  if (!seller) throw new AppError(404, 'NOT_FOUND', 'Seller not found.');
  const sellerProfile = await Seller.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean();
  sendData(res, { ...seller, sellerProfile });
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
