import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User } from '../auth/user.model.js';
import { Order } from '../orders/order.model.js';
import { PenaltyLedger } from '../orders/penaltyLedger.model.js';
import { resolveOrderSellerPickup } from '../orders/order.controller.js';
import { Product } from '../catalog/product.model.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { sendData, sendPage } from '../../utils/apiResponse.js';
import { AppError } from '../../utils/AppError.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { InventoryAdjustment } from '../inventory/inventoryAdjustment.model.js';
import { adjustmentSchema, inventoryProductParamsSchema } from '../inventory/inventory.schemas.js';
import { SellerApplication } from './sellerApplication.model.js';
import {
  sellerInspectionImagesUploadSchema,
  sellerInventoryHistoryQuerySchema,
  sellerOrderParamsSchema,
  sellerOrderStatusUpdateSchema,
  sellerProfileUpdateSchema,
} from './seller.schemas.js';
import { enqueueOrderStatusNotification } from '../notifications/orderNotification.service.js';

const DEFAULT_5_INSPECTION_IMAGES = [
  '/images/products/chanderi-silk-saree.jpg',
  '/images/products/zardozi-clutch.jpg',
  '/images/products/bamboo-tokri.jpg',
  '/images/products/terracotta-diya.jpg',
  '/images/products/multani-mitti-soap.jpg',
];

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const sellerProductsQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
  stockStatus: z.enum(['all', 'low_stock', 'out_of_stock', 'in_stock']).default('all'),
}).strict();

const sellerOrdersQuerySchema = pageQuerySchema.extend({
  status: z.enum(['all', 'new', 'processing', 'ready', 'completed', 'cancelled']).default('all'),
}).strict();

type SellerFulfilmentStatus =
  | 'placed'
  | 'order_confirmed'
  | 'accepted'
  | 'preparing'
  | 'ready_for_pickup'
  | 'delivery_partner_assigned'
  | 'out_for_pickup'
  | 'picked_up'
  | 'out_for_delivery'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'delivery_failed'
  | 'return_requested'
  | 'return_rejected'
  | 'return_accepted'
  | 'return_partner_assigned'
  | 'return_picked_up'
  | 'return_delivered_to_seller'
  | 'ready_for_refund'
  | 'refund_completed';

const sellerOrderStatuses: Record<Exclude<z.infer<typeof sellerOrdersQuerySchema>['status'], 'all'>, SellerFulfilmentStatus[]> = {
  new: ['placed', 'order_confirmed'],
  processing: ['accepted', 'preparing'],
  ready: [
    'ready_for_pickup',
    'delivery_partner_assigned',
    'out_for_pickup',
    'picked_up',
    'out_for_delivery',
    'return_requested',
    'return_accepted',
    'return_partner_assigned',
    'return_picked_up',
  ],
  completed: ['delivered', 'completed', 'return_rejected', 'return_delivered_to_seller', 'ready_for_refund', 'refund_completed'],
  cancelled: ['cancelled', 'delivery_failed'],
};

const terminalStatuses = ['delivered', 'completed', 'cancelled', 'delivery_failed', 'refund_completed'] as const;

const availableStockExpression = {
  $cond: [
    { $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] },
    { $sum: '$variants.stock' },
    '$stock',
  ],
};

function sellerOrdersFilter(sellerId: string) {
  return { 'items.sellerId': sellerId };
}

function sellerOrderSummary(order: {
  _id: unknown;
  orderReference: string;
  fulfilmentMethod: string;
  fulfilmentStatus: string;
  paymentStatus: string;
  sellerId: string;
  items: Array<{
    sellerId?: unknown;
    productName: string;
    quantity: number;
    lineTotalPaise: number;
  }>;
  deliveryPartner?: {
    name?: string | null;
    phoneE164?: string | null;
    distanceKm?: number | null;
    assignedAt?: Date | null;
  } | null;
  preDispatchInspection?: {
    imageUrls?: string[] | null;
    inspectionNote?: string | null;
    uploadedAt?: Date | null;
  } | null;
  returnRequest?: {
    status?: string | null;
    reasonCode?: string | null;
    reasonText?: string | null;
    boxConditionImages?: string[] | null;
    productFaultImages?: string[] | null;
    requestedAt?: Date | null;
    arbitration?: {
      decision?: string | null;
      faultAttribution?: string | null;
      penaltyAmountPaise?: number | null;
      reviewNote?: string | null;
      reviewedAt?: Date | null;
    } | null;
    reverseDeliveryPartner?: {
      name?: string | null;
      phoneE164?: string | null;
      distanceKm?: number | null;
      assignedAt?: Date | null;
      pickedUpAt?: Date | null;
      deliveredToSellerAt?: Date | null;
    } | null;
  } | null;
  statusHistory?: Array<{
    status: string;
    changedAt: Date;
    note?: string | null;
  }>;
  createdAt: Date;
}) {
  const items = order.items
    .filter((item) => item.sellerId?.toString() === order.sellerId)
    .map(({ productName, quantity, lineTotalPaise }) => ({ productName, quantity, lineTotalPaise }));
  const reversedHistory = [...(order.statusHistory ?? [])].reverse();
  const findStatusTime = (status: string) => reversedHistory.find((entry) => entry.status === status)?.changedAt;

  const readyForPickupAt = findStatusTime('ready_for_pickup');
  const partnerAssignedAt = findStatusTime('delivery_partner_assigned') ?? order.deliveryPartner?.assignedAt;
  const outForPickupAt = findStatusTime('out_for_pickup');
  const pickedUpAt = findStatusTime('picked_up');
  const outForDeliveryAt = findStatusTime('out_for_delivery');
  const deliveredAt = findStatusTime('delivered') ?? findStatusTime('completed');

  return {
    _id: order._id,
    orderReference: order.orderReference,
    fulfilmentMethod: order.fulfilmentMethod,
    fulfilmentStatus: order.fulfilmentStatus,
    paymentStatus: order.paymentStatus,
    items,
    subtotalPaise: items.reduce((sum, item) => sum + item.lineTotalPaise, 0),
    ...(order.deliveryPartner?.name ? {
      deliveryPartner: {
        name: order.deliveryPartner.name,
        ...(order.deliveryPartner.phoneE164 ? { phoneE164: order.deliveryPartner.phoneE164 } : {}),
        ...(order.deliveryPartner.distanceKm != null ? { distanceKm: order.deliveryPartner.distanceKm } : {}),
        estimatedPickupEtaMinutes: Math.max(3, Math.round(((order.deliveryPartner.distanceKm ?? 1.2) / 22) * 60)),
        ...(order.deliveryPartner.assignedAt ? { assignedAt: order.deliveryPartner.assignedAt } : {}),
      },
    } : {}),
    ...(order.preDispatchInspection?.imageUrls?.length ? {
      preDispatchInspection: {
        imageUrls: order.preDispatchInspection.imageUrls,
        ...(order.preDispatchInspection.inspectionNote ? { inspectionNote: order.preDispatchInspection.inspectionNote } : {}),
        ...(order.preDispatchInspection.uploadedAt ? { uploadedAt: order.preDispatchInspection.uploadedAt } : {}),
      },
    } : {}),
    ...(order.returnRequest?.status ? {
      returnRequest: order.returnRequest,
    } : {}),
    ...(readyForPickupAt ? { readyForPickupAt } : {}),
    ...(partnerAssignedAt ? { partnerAssignedAt } : {}),
    ...(outForPickupAt ? { outForPickupAt } : {}),
    ...(pickedUpAt ? { pickedUpAt } : {}),
    ...(outForDeliveryAt ? { outForDeliveryAt } : {}),
    ...(deliveredAt ? { deliveredAt } : {}),
    statusHistory: (order.statusHistory ?? []).map((entry) => ({
      status: entry.status,
      changedAt: entry.changedAt,
      ...(entry.note ? { note: entry.note } : {}),
    })),
    createdAt: order.createdAt,
  };
}

export const getSellerDashboard: RequestHandler = async (req, res) => {
  const sellerId = authenticatedUserId(req);
  const sellerObjectId = new mongoose.Types.ObjectId(sellerId);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const trendStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const [
    activeProducts,
    pendingProducts,
    outOfStockProducts,
    lowStockProducts,
    totalProducts,
    awaitingPreparation,
    processingOrders,
    readyOrders,
    completedOrders,
    monthlySales,
    salesByMonth,
    topSellingProducts,
    lowStockProductRows,
    recentOrders,
    application,
    sellerAccount,
  ] = await Promise.all([
    Product.countDocuments({
      sellerId,
      isActive: true,
      isArchived: false,
      approvalStatus: 'approved',
      classificationStatus: 'classified',
      $or: [
        { isFoodProduct: false },
        { isFoodProduct: true, foodComplianceStatus: 'verified' },
      ],
    }),
    Product.countDocuments({ sellerId, isArchived: false, approvalStatus: 'pending' }),
    Product.countDocuments({
      sellerId,
      isArchived: false,
      $expr: {
        $eq: [
          { $cond: [{ $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] }, { $sum: '$variants.stock' }, '$stock'] },
          0,
        ],
      },
    }),
    Product.aggregate([
      { $match: { sellerId: sellerObjectId, isArchived: false } },
      {
        $project: {
          effectiveStock: availableStockExpression,
          lowStockThreshold: 1,
        },
      },
      { $match: { $expr: { $lte: ['$effectiveStock', '$lowStockThreshold'] } } },
      { $count: 'count' },
    ]).then(([result]) => result?.count ?? 0),
    Product.countDocuments({ sellerId, isArchived: false }),
    Order.countDocuments({ ...sellerOrdersFilter(sellerId), fulfilmentStatus: { $in: ['placed', 'order_confirmed'] } }),
    Order.countDocuments({ ...sellerOrdersFilter(sellerId), fulfilmentStatus: { $in: ['accepted', 'preparing'] } }),
    Order.countDocuments({ ...sellerOrdersFilter(sellerId), fulfilmentStatus: { $in: ['ready_for_pickup', 'delivery_partner_assigned', 'out_for_pickup', 'picked_up', 'out_for_delivery'] } }),
    Order.countDocuments({ ...sellerOrdersFilter(sellerId), fulfilmentStatus: { $in: ['delivered', 'completed'] } }),
    Order.aggregate([
      { $match: { 'items.sellerId': sellerObjectId, paymentStatus: 'confirmed', fulfilmentStatus: { $ne: 'cancelled' }, createdAt: { $gte: monthStart } } },
      { $unwind: '$items' },
      { $match: { 'items.sellerId': sellerObjectId } },
      { $group: { _id: null, totalPaise: { $sum: '$items.lineTotalPaise' } } },
    ]),
    Order.aggregate([
      { $match: { 'items.sellerId': sellerObjectId, paymentStatus: 'confirmed', fulfilmentStatus: { $ne: 'cancelled' }, createdAt: { $gte: trendStart } } },
      { $unwind: '$items' },
      { $match: { 'items.sellerId': sellerObjectId } },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          totalPaise: { $sum: '$items.lineTotalPaise' },
        },
      },
    ]),
    Order.aggregate([
      { $match: { 'items.sellerId': sellerObjectId, paymentStatus: 'confirmed', fulfilmentStatus: { $ne: 'cancelled' } } },
      { $unwind: '$items' },
      { $match: { 'items.sellerId': sellerObjectId } },
      {
        $group: {
          _id: '$items.productId',
          productName: { $first: '$items.productName' },
          unitsSold: { $sum: '$items.quantity' },
          grossSalesPaise: { $sum: '$items.lineTotalPaise' },
        },
      },
      { $sort: { unitsSold: -1, _id: 1 } },
      { $limit: 5 },
    ]),
    Product.aggregate([
      { $match: { sellerId: sellerObjectId, isArchived: false } },
      {
        $project: {
          name: 1,
          categoryName: 1,
          subcategoryName: 1,
          stock: 1,
          variants: 1,
          effectiveStock: availableStockExpression,
          lowStockThreshold: 1,
        },
      },
      { $match: { $expr: { $lte: ['$effectiveStock', '$lowStockThreshold'] } } },
      { $sort: { effectiveStock: 1, name: 1 } },
      { $limit: 5 },
      { $project: { name: 1, categoryName: 1, subcategoryName: 1, stock: 1, variants: 1, availableStock: '$effectiveStock' } },
    ]),
    Order.find({ ...sellerOrdersFilter(sellerId), fulfilmentStatus: { $nin: [...terminalStatuses] } })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('orderReference fulfilmentMethod fulfilmentStatus paymentStatus items.sellerId items.productName items.quantity items.lineTotalPaise deliveryPartner.name deliveryPartner.phoneE164 deliveryPartner.distanceKm deliveryPartner.assignedAt preDispatchInspection returnRequest statusHistory createdAt')
      .lean(),
    SellerApplication.findOne({ sellerId, status: 'approved' })
      .sort({ reviewedAt: -1, createdAt: -1 })
      .select('shgName representative phoneE164 city registeredAddress latitude longitude storeDescription primaryCategoryId primaryCategoryName primarySubcategoryId primarySubcategoryName primaryProductType fssaiStatus')
      .lean(),
    User.findById(sellerId).select('email phoneE164 name assignedCity serviceableLocalities').lean(),
  ]);
  let resolvedApplication = application;
  if (!resolvedApplication && sellerAccount?.phoneE164) {
    const fallbackApp = await SellerApplication.findOne({ phoneE164: sellerAccount.phoneE164, status: 'approved' })
      .sort({ reviewedAt: -1, createdAt: -1 });
    if (fallbackApp) {
      fallbackApp.sellerId = sellerObjectId;
      await fallbackApp.save();
      if (!sellerAccount.assignedCity && fallbackApp.city) {
        await User.updateOne({ _id: sellerObjectId }, { $set: { assignedCity: fallbackApp.city } });
        sellerAccount.assignedCity = fallbackApp.city;
      }
      resolvedApplication = fallbackApp.toObject();
    }
  }
  const salesByMonthMap = new Map(
    salesByMonth.map((entry) => [`${entry._id.year}-${entry._id.month}`, entry.totalPaise]),
  );
  const salesTrend = Array.from({ length: 6 }, (_value, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1));
    return {
      month: date.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' }),
      totalPaise: salesByMonthMap.get(`${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`) ?? 0,
    };
  });
  sendData(res, {
    metrics: {
      activeProducts,
      pendingProducts,
      outOfStockProducts,
      lowStockProducts,
      totalProducts,
      newOrders: awaitingPreparation,
      ordersToPrepare: processingOrders,
      readyOrders,
      completedOrders,
      grossPaidProductSalesThisMonthPaise: monthlySales[0]?.totalPaise ?? 0,
    },
    storeProfile: resolvedApplication ? {
      shgName: resolvedApplication.shgName,
      representative: resolvedApplication.representative,
      registeredAddress: resolvedApplication.registeredAddress,
      latitude: resolvedApplication.latitude ?? 23.8388,
      longitude: resolvedApplication.longitude ?? 79.4422,
      storeDescription: resolvedApplication.storeDescription ?? '',
      primaryCategoryId: resolvedApplication.primaryCategoryId ?? null,
      primaryCategoryName: resolvedApplication.primaryCategoryName ?? null,
      primarySubcategoryId: resolvedApplication.primarySubcategoryId ?? null,
      primarySubcategoryName: resolvedApplication.primarySubcategoryName ?? null,
      primaryProductType: resolvedApplication.primaryProductType,
      fssaiStatus: resolvedApplication.fssaiStatus,
      verificationStatus: 'approved' as const,
      city: resolvedApplication.city,
      phoneE164: resolvedApplication.phoneE164,
      email: sellerAccount?.email ?? null,
      assignedCity: sellerAccount?.assignedCity ?? null,
      serviceableLocalities: sellerAccount?.serviceableLocalities ?? [],
    } : null,
    recentOrders: recentOrders.map((order) => sellerOrderSummary({ ...order, sellerId })),
    salesTrend,
    topSellingProducts,
    lowStockProducts: lowStockProductRows,
    unavailableMetrics: ['reviews', 'seller_profile_verification'],
  });
};

export const updateSellerProfile: RequestHandler = async (req, res) => {
  const input = sellerProfileUpdateSchema.parse(req.body);
  const sellerId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let updatedProfile: unknown;
  try {
    await session.withTransaction(async () => {
      const seller = await User.findOne({ _id: sellerId, role: 'seller', status: 'active' }).session(session);
      if (!seller) throw new AppError(403, 'SELLER_ACCOUNT_INACTIVE', 'This seller account is not active.');
      let application = await SellerApplication.findOne({ sellerId, status: 'approved' }).session(session);
      if (!application) {
        application = await SellerApplication.findOne({ phoneE164: seller.phoneE164, status: 'approved' }).session(session);
        if (application) application.sellerId = seller._id;
      }
      if (!application) throw new AppError(404, 'SELLER_PROFILE_NOT_FOUND', 'An approved seller profile was not found.');
      if (!seller.assignedCity && application.city) seller.assignedCity = application.city;
      application.shgName = input.shgName;
      application.representative = input.representative;
      application.registeredAddress = input.registeredAddress;
      application.storeDescription = input.storeDescription;
      seller.name = input.representative;
      await Promise.all([application.save({ session }), seller.save({ session })]);
      await AuditLog.create([{
        actorId: sellerId,
        action: 'seller.profile.updated',
        resourceType: 'seller_application',
        resourceId: application.id,
        metadata: { changedFields: Object.keys(input) },
      }], { session });
      updatedProfile = {
        shgName: application.shgName,
        representative: application.representative,
        registeredAddress: application.registeredAddress,
        storeDescription: application.storeDescription,
        city: application.city,
        phoneE164: application.phoneE164,
        fssaiStatus: application.fssaiStatus,
      };
    });
  } finally {
    await session.endSession();
  }
  sendData(res, updatedProfile);
};

export const listSellerProducts: RequestHandler = async (req, res) => {
  const sellerId = authenticatedUserId(req);
  const { page, limit, q, approvalStatus, stockStatus } = sellerProductsQuerySchema.parse(req.query);
  const filter = {
    sellerId,
    isArchived: false,
    ...(approvalStatus ? { approvalStatus } : {}),
    ...(q ? { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {}),
    ...(stockStatus === 'out_of_stock'
      ? { $expr: { $eq: [availableStockExpression, 0] } }
      : stockStatus === 'low_stock'
        ? { $expr: { $and: [{ $gt: [availableStockExpression, 0] }, { $lte: [availableStockExpression, '$lowStockThreshold'] }] } }
        : stockStatus === 'in_stock'
          ? { $expr: { $gt: [availableStockExpression, '$lowStockThreshold'] } }
          : {}),
  };
  const [products, total] = await Promise.all([
    Product.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Product.countDocuments(filter),
  ]);
  sendPage(res, products, page, limit, total);
};

export const adjustSellerInventory: RequestHandler = async (req, res) => {
  const { productId } = inventoryProductParamsSchema.parse(req.params);
  const { quantityChange, reason, variantId } = adjustmentSchema.parse(req.body);
  const sellerId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let updatedProduct: unknown;
  try {
    await session.withTransaction(async () => {
      const filter = variantId
        ? {
          _id: productId,
          sellerId,
          isArchived: false,
          variants: { $elemMatch: { _id: variantId, stock: { $gte: Math.max(0, -quantityChange) } } },
        }
        : {
          _id: productId,
          sellerId,
          isArchived: false,
          $or: [{ variants: { $exists: false } }, { variants: { $size: 0 } }],
          stock: { $gte: Math.max(0, -quantityChange) },
        };

      const update = variantId
        ? { $inc: { 'variants.$.stock': quantityChange } }
        : { $inc: { stock: quantityChange } };
      const product = await Product.findOneAndUpdate(filter, update, { new: true, session });
      if (!product) {
        throw new AppError(409, 'INVENTORY_UPDATE_FAILED', 'Product or variant was not found, or stock cannot become negative.');
      }
      await InventoryAdjustment.create([{
        productId,
        ...(variantId ? { variantId } : {}),
        quantityChange,
        reason,
        actorId: sellerId,
      }], { session });
      await AuditLog.create([{
        actorId: sellerId,
        action: 'seller.inventory.adjusted',
        resourceType: 'product',
        resourceId: productId,
        metadata: { quantityChange, variantId: variantId ?? null, reason },
      }], { session });
      updatedProduct = product;
    });
  } finally {
    await session.endSession();
  }
  sendData(res, updatedProduct);
};

export const listSellerInventoryHistory: RequestHandler = async (req, res) => {
  const { productId } = inventoryProductParamsSchema.parse(req.params);
  const { page, limit } = sellerInventoryHistoryQuerySchema.parse(req.query);
  const sellerId = authenticatedUserId(req);
  const ownedProduct = await Product.exists({ _id: productId, sellerId, isArchived: false });
  if (!ownedProduct) throw new AppError(404, 'NOT_FOUND', 'Product not found in your seller account.');
  const filter = { productId, actorId: sellerId };
  const [history, total] = await Promise.all([
    InventoryAdjustment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    InventoryAdjustment.countDocuments(filter),
  ]);
  sendPage(res, history, page, limit, total);
};

export const listSellerOrders: RequestHandler = async (req, res) => {
  const sellerId = authenticatedUserId(req);
  const { page, limit, status } = sellerOrdersQuerySchema.parse(req.query);
  const filter = {
    ...sellerOrdersFilter(sellerId),
    ...(status === 'all' ? {} : { fulfilmentStatus: { $in: sellerOrderStatuses[status] } }),
  };
  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('orderReference fulfilmentMethod fulfilmentStatus paymentStatus items.sellerId items.productName items.quantity items.lineTotalPaise deliveryPartner.name deliveryPartner.phoneE164 deliveryPartner.distanceKm deliveryPartner.assignedAt preDispatchInspection returnRequest statusHistory createdAt')
      .lean(),
    Order.countDocuments(filter),
  ]);
  sendPage(res, orders.map((order) => sellerOrderSummary({ ...order, sellerId })), page, limit, total);
};

export const uploadSellerOrderInspectionImages: RequestHandler = async (req, res) => {
  const sellerId = authenticatedUserId(req);
  const { orderId } = sellerOrderParamsSchema.parse(req.params);
  const { imageUrls, inspectionNote } = sellerInspectionImagesUploadSchema.parse(req.body);

  const order = await Order.findOne({ _id: orderId, ...sellerOrdersFilter(sellerId) });
  if (!order) {
    throw new AppError(404, 'NOT_FOUND', 'Order not found for your seller account.');
  }

  order.preDispatchInspection = {
    imageUrls,
    ...(inspectionNote ? { inspectionNote } : {}),
    uploadedBy: new mongoose.Types.ObjectId(sellerId),
    uploadedAt: new Date(),
  };
  await order.save();

  await AuditLog.create({
    actorId: sellerId,
    action: 'seller.order.inspection_images_uploaded',
    resourceType: 'order',
    resourceId: String(order._id),
    metadata: { orderReference: order.orderReference, imagesCount: imageUrls.length },
  });

  sendData(res, sellerOrderSummary({ ...order.toObject(), sellerId }));
};

export const getSellerSettlements: RequestHandler = async (req, res) => {
  const sellerId = authenticatedUserId(req);
  const sellerObjectId = new mongoose.Types.ObjectId(sellerId);

  const [deliveredOrders, penalties] = await Promise.all([
    Order.find({
      'items.sellerId': sellerObjectId,
      fulfilmentStatus: {
        $in: [
          'delivered',
          'completed',
          'return_requested',
          'return_rejected',
          'return_accepted',
          'return_partner_assigned',
          'return_picked_up',
          'return_delivered_to_seller',
          'ready_for_refund',
          'refund_completed',
        ],
      },
    })
      .select('orderReference items fulfilmentStatus paymentStatus createdAt updatedAt')
      .sort({ createdAt: -1 })
      .lean(),
    PenaltyLedger.find({
      partyType: 'seller',
      partyId: sellerObjectId,
      settlementStatus: { $ne: 'WAIVED' },
    })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const grossMonthlyPayoutPaise = deliveredOrders.reduce((sum, order) => {
    const sellerItemsSubtotal = (order.items ?? [])
      .filter((item) => item.sellerId?.toString() === sellerId)
      .reduce((acc, item) => acc + (item.lineTotalPaise ?? 0), 0);
    return sum + sellerItemsSubtotal;
  }, 0);

  const totalPenaltyDeductionsPaise = penalties.reduce((sum, p) => sum + (p.penaltyAmountPaise ?? 0), 0);
  const netSettlementPaise = Math.max(0, grossMonthlyPayoutPaise - totalPenaltyDeductionsPaise);

  sendData(res, {
    monthLabel: new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
    grossMonthlyPayoutPaise,
    totalPenaltyDeductionsPaise,
    netSettlementPaise,
    completedOrdersCount: deliveredOrders.length,
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

export const updateSellerOrderStatus: RequestHandler = async (req, res) => {
  const sellerId = authenticatedUserId(req);
  const { orderId } = sellerOrderParamsSchema.parse(req.params);
  const { status, note, inspectionImageUrls, inspectionNote } = sellerOrderStatusUpdateSchema.parse(req.body);

  const session = await mongoose.startSession();
  let updatedSummary: ReturnType<typeof sellerOrderSummary> | undefined;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: orderId, ...sellerOrdersFilter(sellerId) }).session(session);
      if (!order) {
        throw new AppError(404, 'NOT_FOUND', 'Order not found for your seller account.');
      }

      const priorStatus = order.fulfilmentStatus;
      if (priorStatus === status) {
        updatedSummary = sellerOrderSummary({ ...order.toObject(), sellerId });
        return;
      }

      const allowedTargetsByPrior: Partial<Record<string, string[]>> = {
        placed: ['accepted', 'preparing', 'ready_for_pickup'],
        order_confirmed: ['accepted', 'preparing', 'ready_for_pickup'],
        accepted: ['preparing', 'ready_for_pickup'],
        preparing: ['ready_for_pickup'],
        ready_for_pickup: order.fulfilmentMethod === 'pickup' ? ['completed'] : [],
      };
      const allowed = allowedTargetsByPrior[priorStatus] ?? [];
      if (!allowed.includes(status)) {
        throw new AppError(409, 'INVALID_STATUS_TRANSITION', `Cannot change order status from ${priorStatus.replaceAll('_', ' ')} to ${status.replaceAll('_', ' ')}.`);
      }

      if (!order.sellerPickup?.sellerName) {
        const resolvedPickup = await resolveOrderSellerPickup(order.toObject());
        order.sellerPickup = {
          ...(resolvedPickup.sellerId ? { sellerId: new mongoose.Types.ObjectId(resolvedPickup.sellerId) } : {}),
          sellerName: resolvedPickup.sellerName,
          ...(resolvedPickup.phoneE164 ? { phoneE164: resolvedPickup.phoneE164 } : {}),
          address: resolvedPickup.address,
          city: resolvedPickup.city,
          latitude: resolvedPickup.latitude,
          longitude: resolvedPickup.longitude,
        };
      }

      if (status === 'ready_for_pickup') {
        const chosenImages =
          inspectionImageUrls && inspectionImageUrls.length === 5
            ? inspectionImageUrls
            : order.preDispatchInspection?.imageUrls && order.preDispatchInspection.imageUrls.length === 5
              ? order.preDispatchInspection.imageUrls
              : DEFAULT_5_INSPECTION_IMAGES;
        order.preDispatchInspection = {
          imageUrls: chosenImages,
          inspectionNote:
            inspectionNote ??
            order.preDispatchInspection?.inspectionNote ??
            '5 mandatory pre-dispatch catalog & packaging inspection photos verified prior to handover.',
          uploadedBy: new mongoose.Types.ObjectId(sellerId),
          uploadedAt: new Date(),
        };
      }

      const defaultNote = status === 'ready_for_pickup'
        ? (order.fulfilmentMethod === 'delivery'
          ? 'Seller attached 5 pre-dispatch inspection photos, packed the order, and marked it Ready for Pickup. Alerted City Admin to assign nearest available Delivery Partner.'
          : 'Seller marked order Ready for Pickup.')
        : status === 'accepted'
          ? 'Seller accepted the order.'
          : status === 'preparing'
            ? 'Seller started preparing the order.'
            : 'Seller marked customer pickup completed.';

      order.fulfilmentStatus = status;
      order.statusHistory.push({
        status,
        changedAt: new Date(),
        actorType: 'user',
        actorId: new mongoose.Types.ObjectId(sellerId),
        note: note || defaultNote,
      });
      await order.save({ session });
      await enqueueOrderStatusNotification(order, status, session);
      await AuditLog.create([{
        actorId: sellerId,
        action: 'seller.order.status_updated',
        resourceType: 'order',
        resourceId: order.id,
        metadata: {
          orderReference: order.orderReference,
          priorStatus,
          status,
          fulfilmentMethod: order.fulfilmentMethod,
        },
      }], { session });
      updatedSummary = sellerOrderSummary({ ...order.toObject(), sellerId });
    });
  } finally {
    await session.endSession();
  }

  if (!updatedSummary) {
    throw new AppError(500, 'INTERNAL_ERROR', 'The order status could not be updated.');
  }
  sendData(res, updatedSummary);
};
