import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Order } from '../orders/order.model.js';
import { Product } from '../catalog/product.model.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { sendData, sendPage } from '../../utils/apiResponse.js';

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const terminalStatuses = ['delivered', 'completed', 'cancelled', 'delivery_failed'] as const;

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
  createdAt: Date;
}) {
  const items = order.items
    .filter((item) => item.sellerId?.toString() === order.sellerId)
    .map(({ productName, quantity, lineTotalPaise }) => ({ productName, quantity, lineTotalPaise }));
  return {
    _id: order._id,
    orderReference: order.orderReference,
    fulfilmentMethod: order.fulfilmentMethod,
    fulfilmentStatus: order.fulfilmentStatus,
    paymentStatus: order.paymentStatus,
    items,
    subtotalPaise: items.reduce((sum, item) => sum + item.lineTotalPaise, 0),
    createdAt: order.createdAt,
  };
}

export const getSellerDashboard: RequestHandler = async (req, res) => {
  const sellerId = authenticatedUserId(req);
  const sellerObjectId = new mongoose.Types.ObjectId(sellerId);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [
    activeProducts,
    lowStockProducts,
    totalProducts,
    awaitingPreparation,
    processingOrders,
    readyOrders,
    completedOrders,
    monthlySales,
    recentOrders,
  ] = await Promise.all([
    Product.countDocuments({ sellerId, isActive: true, isArchived: false }),
    Product.aggregate([
      { $match: { sellerId: sellerObjectId, isArchived: false } },
      {
        $project: {
          effectiveStock: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] },
              { $sum: '$variants.stock' },
              '$stock',
            ],
          },
          lowStockThreshold: 1,
        },
      },
      { $match: { $expr: { $lte: ['$effectiveStock', '$lowStockThreshold'] } } },
      { $count: 'count' },
    ]).then(([result]) => result?.count ?? 0),
    Product.countDocuments({ sellerId, isArchived: false }),
    Order.countDocuments({ ...sellerOrdersFilter(sellerId), fulfilmentStatus: 'placed' }),
    Order.countDocuments({ ...sellerOrdersFilter(sellerId), fulfilmentStatus: { $in: ['accepted', 'preparing'] } }),
    Order.countDocuments({ ...sellerOrdersFilter(sellerId), fulfilmentStatus: 'ready_for_pickup' }),
    Order.countDocuments({ ...sellerOrdersFilter(sellerId), fulfilmentStatus: { $in: ['delivered', 'completed'] } }),
    Order.aggregate([
      { $match: { 'items.sellerId': sellerObjectId, paymentStatus: 'confirmed', fulfilmentStatus: { $ne: 'cancelled' }, createdAt: { $gte: monthStart } } },
      { $unwind: '$items' },
      { $match: { 'items.sellerId': sellerObjectId } },
      { $group: { _id: null, totalPaise: { $sum: '$items.lineTotalPaise' } } },
    ]),
    Order.find({ ...sellerOrdersFilter(sellerId), fulfilmentStatus: { $nin: [...terminalStatuses] } })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('orderReference fulfilmentMethod fulfilmentStatus paymentStatus items.sellerId items.productName items.quantity items.lineTotalPaise createdAt')
      .lean(),
  ]);
  sendData(res, {
    metrics: {
      activeProducts,
      lowStockProducts,
      totalProducts,
      newOrders: awaitingPreparation,
      ordersToPrepare: processingOrders,
      readyOrders,
      completedOrders,
      grossPaidProductSalesThisMonthPaise: monthlySales[0]?.totalPaise ?? 0,
    },
    recentOrders: recentOrders.map((order) => sellerOrderSummary({ ...order, sellerId })),
    unavailableMetrics: ['seller_settlements', 'pending_payout', 'reviews', 'seller_profile_verification'],
  });
};

export const listSellerProducts: RequestHandler = async (req, res) => {
  const sellerId = authenticatedUserId(req);
  const { page, limit } = pageQuerySchema.parse(req.query);
  const filter = { sellerId, isArchived: false };
  const [products, total] = await Promise.all([
    Product.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Product.countDocuments(filter),
  ]);
  sendPage(res, products, page, limit, total);
};

export const listSellerOrders: RequestHandler = async (req, res) => {
  const sellerId = authenticatedUserId(req);
  const { page, limit } = pageQuerySchema.parse(req.query);
  const filter = sellerOrdersFilter(sellerId);
  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('orderReference fulfilmentMethod fulfilmentStatus paymentStatus items.sellerId items.productName items.quantity items.lineTotalPaise createdAt')
      .lean(),
    Order.countDocuments(filter),
  ]);
  sendPage(res, orders.map((order) => sellerOrderSummary({ ...order, sellerId })), page, limit, total);
};
