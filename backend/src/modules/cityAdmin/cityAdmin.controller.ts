import { CashRemittance } from '../orders/cashRemittance.model.js';
import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../utils/AppError.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { sendData, sendPage } from '../../utils/apiResponse.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { DELIVERY_STATUS_ENUM, FULFILMENT_STATUS_ENUM, Order } from '../orders/order.model.js';
import { resolveOrderSellerPickup } from '../orders/order.controller.js';
import { Settings } from '../settings/settings.model.js';
import { SellerApplication } from '../seller/sellerApplication.model.js';
import { Seller } from '../../models/Seller.js';
import { User } from '../auth/user.model.js';
import { Product } from '../catalog/product.model.js';
import { getCategorySelection } from '../catalog/categoryMaster.js';
import { CityAdminProductFlag } from './cityAdminProductFlag.model.js';
import { ServiceZoneChangeRequest } from './serviceZoneChangeRequest.model.js';

const orderQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  fulfilmentStatus: z.enum([...FULFILMENT_STATUS_ENUM]).optional(),
  deliveryStatus: z.enum([...DELIVERY_STATUS_ENUM]).optional(),
  paymentStatus: z.enum(['pending_verification', 'confirmed', 'rejected', 'refunded']).optional(),
  unassignedOnly: z.enum(['true', 'false']).optional(),
  sellerId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  deliveryPartnerId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((query, context) => {
  if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
    context.addIssue({ code: 'custom', path: ['from'], message: '`from` must be earlier than or equal to `to`.' });
  }
});

const sellerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
}).strict();

const cityAdminProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  categoryId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  subcategoryId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
  sellerId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  stockStatus: z.enum(['all', 'low_stock', 'out_of_stock']).default('all'),
  listingStatus: z.enum(['all', 'active', 'inactive', 'archived']).default('all'),
}).strict();

const activeAssignmentStatuses = [
  'placed',
  'order_confirmed',
  'accepted',
  'preparing',
  'ready_for_pickup',
  'delivery_partner_assigned',
  'out_for_pickup',
  'picked_up',
  'out_for_delivery',
  'delivery_failed',
] as const;
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
    sellerApplicationsToReview,
    outForDelivery,
    deliveredToday,
    ordersNeedingAction,
    paymentsToReview,
    ordersByStatus,
    dailyOrders,
    recentOrders,
    assignmentExceptions,
    citySellersResult,
  ] = await Promise.all([
    Order.countDocuments({ ...scope, createdAt: { $gte: today, $lt: tomorrow } }),
    Order.countDocuments({
      ...scope,
      fulfilmentMethod: 'delivery',
      fulfilmentStatus: { $in: ['ready_for_pickup', 'delivery_failed'] },
      'deliveryPartner.name': { $exists: false },
    }),
    SellerApplication.countDocuments({ city: cityFilter(city), status: 'pending' }),
    Order.countDocuments({ ...scope, fulfilmentStatus: { $in: ['out_for_pickup', 'picked_up', 'out_for_delivery', 'return_picked_up'] } }),
    Order.aggregate([
      { $match: { ...scope, fulfilmentStatus: { $in: ['delivered', 'completed'] } } },
      { $project: { currentStatus: { $arrayElemAt: ['$statusHistory', -1] } } },
      { $match: { 'currentStatus.changedAt': { $gte: today, $lt: tomorrow } } },
      { $count: 'total' },
    ]),
    Order.countDocuments({
      ...scope,
      fulfilmentStatus: {
        $in: [
          'placed',
          'order_confirmed',
          'accepted',
          'preparing',
          'ready_for_pickup',
          'return_requested',
          'return_accepted',
          'return_delivered_to_seller',
        ],
      },
    }),
    Order.countDocuments({ ...scope, paymentStatus: 'pending_verification' }),
    Order.aggregate([
      { $match: { ...scope } },
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
      .limit(10)
      .select('orderReference customerName customerPhoneE164 items.productId items.sellerId items.productName items.quantity subtotalPaise deliveryFeePaise totalPaise paymentMethod paymentStatus fulfilmentMethod fulfilmentStatus deliveryPartner.userId deliveryPartner.name deliveryPartner.phoneE164 deliveryPartner.distanceKm deliveryPartner.assignedAt address sellerPickup preDispatchInspection returnRequest statusHistory deliveryStatus deliveryExceptions adminResolution createdAt')
      .lean(),
    Order.find({
      ...scope,
      fulfilmentMethod: 'delivery',
      fulfilmentStatus: { $in: ['ready_for_pickup', 'delivery_failed'] },
      'deliveryPartner.name': { $exists: false },
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('orderReference address.locality fulfilmentStatus createdAt')
      .lean(),
    findCitySellers(city),
  ]);
  const dailyCounts = new Map(dailyOrders.map(({ _id, count }) => [_id, count]));
  const ordersOverTime = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(chartStart);
    date.setUTCDate(chartStart.getUTCDate() + index);
    const day = new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    return { day, count: dailyCounts.get(day) ?? 0 };
  });

  const sortedExceptions = [...assignmentExceptions]
    .sort((a, b) => {
      const aReady = a.fulfilmentStatus === 'ready_for_pickup' ? 0 : 1;
      const bReady = b.fulfilmentStatus === 'ready_for_pickup' ? 0 : 1;
      if (aReady !== bReady) return aReady - bReady;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    })
    .slice(0, 5);

  const citySellers = (citySellersResult as any[]) || [];
  const sellerNames = new Map(citySellers.map((seller) => [String(seller._id), seller.name || seller.phoneE164 || 'Seller']));
  const enrichedRecentOrders = await Promise.all(
    recentOrders.map(async (order) => {
      const sellerPickup = await resolveOrderSellerPickup(order);
      return {
        ...order,
        sellerPickup,
        items: (order.items || []).map((item) => ({
          ...item,
          sellerName: item.sellerId ? sellerNames.get(item.sellerId.toString()) || sellerPickup.sellerName || 'Seller' : undefined,
        })),
      };
    })
  );

  sendData(res, {
    city,
    generatedAt: new Date().toISOString(),
    metrics: {
      todayOrders,
      awaitingAssignment,
      sellerApplicationsToReview: 0,
      outForDelivery,
      deliveredToday: deliveredToday[0]?.total ?? 0,
      ordersNeedingAction,
      paymentsToReview,
    },
    ordersByStatus: ordersByStatus.map(({ _id, count }) => ({ status: _id, count })),
    ordersOverTime,
    recentOrders: enrichedRecentOrders,
    assignmentExceptions: sortedExceptions,
    unavailableMetrics: ['active_delivery_partners', 'partner_applications', 'support_tickets', 'inventory_by_city'],
  });
};

export const getCityAdminServiceZones: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const settings = await Settings.findOne({ key: 'global' }).select('city state deliveryEnabled serviceableLocalities').lean();
  if (!settings || !cityFilter(city).test(settings.city)) {
    sendData(res, { city, configured: false, zones: [] });
    return;
  }

  const zones = await Promise.all(settings.serviceableLocalities.map(async (locality) => ({
    name: locality.name,
    coveredLocalities: [locality.name],
    postalCodes: locality.postalCodes,
    deliveryFeePaise: locality.deliveryFeePaise,
    activeDeliveryCount: await Order.countDocuments({
      'address.city': cityFilter(city),
      'address.locality': new RegExp(`^${escapeRegExp(locality.name)}$`, 'i'),
      fulfilmentMethod: 'delivery',
      fulfilmentStatus: { $in: activeAssignmentStatuses },
    }),
    eligiblePartnerCount: null,
    status: settings.deliveryEnabled ? 'active' : 'disabled',
  })));
  sendData(res, { city, state: settings.state, configured: true, zones, eligiblePartnersTracked: false });
};

async function findCitySellers(city: string) {
  const cityRegex = cityFilter(city);
  const [approvedApplications, sellersInCity] = await Promise.all([
    SellerApplication.find({ city: cityRegex, status: 'approved' })
      .select('sellerId phoneE164 shgName representative registeredAddress latitude longitude')
      .sort({ reviewedAt: -1 })
      .lean(),
    Seller.find({
      $or: [
        { 'pickupAddress.city': cityRegex },
        { 'supplierDetails.district': cityRegex },
      ],
      status: 'ACTIVE',
    }).select('userId supplierDetails pickupAddress status').lean(),
  ]);

  const appSellerIds = approvedApplications.flatMap((app) => (app.sellerId ? [app.sellerId] : []));
  const sellerDocUserIds = sellersInCity.flatMap((s) => (s.userId ? [s.userId] : []));
  const allSellerObjectIds = [...appSellerIds, ...sellerDocUserIds];
  const appPhones = approvedApplications.map((app) => app.phoneE164);

  const sellers = await User.find({
    role: 'seller',
    $or: [
      { assignedCity: cityRegex },
      ...(allSellerObjectIds.length ? [{ _id: { $in: allSellerObjectIds } }] : []),
      ...(appPhones.length ? [{ phoneE164: { $in: appPhones } }] : []),
    ],
  } as any).select('_id name phoneE164 email status assignedCity createdAt').sort({ createdAt: -1 }).lean();

  const shgById = new Map<string, string>();
  const shgByPhone = new Map<string, string>();
  for (const app of approvedApplications) {
    const label = app.shgName || app.representative;
    if (app.sellerId && !shgById.has(String(app.sellerId))) shgById.set(String(app.sellerId), label);
    if (app.phoneE164 && !shgByPhone.has(app.phoneE164)) shgByPhone.set(app.phoneE164, label);
  }
  for (const s of sellersInCity) {
    const label = s.supplierDetails?.shgName || s.supplierDetails?.shgLeaderName;
    if (s.userId && label && !shgById.has(String(s.userId))) shgById.set(String(s.userId), label);
  }

  return sellers.map((seller: any) => ({
    ...seller,
    name: shgById.get(String(seller._id)) || seller.name || shgByPhone.get(seller.phoneE164) || seller.phoneE164,
  }));
}

export const listCityAdminSellers: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const query = sellerQuerySchema.parse(req.query);
  const allCitySellers = await findCitySellers(city);
  const allCitySellerIds = allCitySellers.map((seller) => seller._id);
  const filter = {
    _id: { $in: allCitySellerIds },
    ...(query.q ? {
      $or: [
        { name: { $regex: escapeRegExp(query.q), $options: 'i' } },
        { phoneE164: { $regex: escapeRegExp(query.q), $options: 'i' } },
      ],
    } : {}),
  };
  const [sellers, total] = await Promise.all([
    User.find(filter).select('name phoneE164 email status assignedCity createdAt').sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit).limit(query.limit).lean(),
    User.countDocuments(filter),
  ]);
  const sellerIds = sellers.map((seller) => seller._id);
  const [productStats, orderStats] = await Promise.all([
    Product.aggregate([
      { $match: { sellerId: { $in: sellerIds }, isArchived: false } },
      { $group: { _id: '$sellerId', productCount: { $sum: 1 }, categories: { $addToSet: '$categoryName' } } },
    ]),
    Order.aggregate([
      { $unwind: '$items' },
      { $match: { 'items.sellerId': { $in: sellerIds } } },
      { $group: { _id: { sellerId: '$items.sellerId', orderId: '$_id' } } },
      { $group: { _id: '$_id.sellerId', orderCount: { $sum: 1 } } },
    ]),
  ]);
  const productsBySeller = new Map(productStats.map((stats) => [String(stats._id), stats]));
  const ordersBySeller = new Map(orderStats.map((stats) => [String(stats._id), stats.orderCount]));
  const sellerDocs = await Seller.find({ userId: { $in: sellerIds } } as any).lean();
  const sellerDocMap = new Map((sellerDocs as any[]).map((s) => [String(s.userId), s]));
  sendPage(res, sellers.map((seller: any) => {
    const stats = productsBySeller.get(String(seller._id));
    const profile = sellerDocMap.get(String(seller._id));
    const categories = stats?.categories && stats.categories.length > 0
      ? stats.categories
      : profile?.supplierDetails?.category ? [profile.supplierDetails.category] : [];
    return {
      ...seller,
      name: profile?.supplierDetails?.shgName || seller.name || 'Seller',
      shgName: profile?.supplierDetails?.shgName,
      shgLeaderName: profile?.supplierDetails?.shgLeaderName,
      productCount: stats?.productCount ?? 0,
      productCategories: categories,
      orderCount: ordersBySeller.get(String(seller._id)) ?? 0,
      verificationStatus: profile?.status === 'ACTIVE' ? 'verified' : 'verified',
      sellerProfile: profile,
    };
  }), query.page, query.limit, total);
};

export const listCityAdminProducts: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const query = cityAdminProductsQuerySchema.parse(req.query);
  const sellers = await findCitySellers(city);
  const sellerIds = sellers.map((seller) => seller._id);
  if (!sellerIds.length || (query.sellerId && !sellerIds.some((id) => String(id) === query.sellerId))) {
    sendPage(res, [], query.page, query.limit, 0);
    return;
  }

  const filter: Record<string, unknown> = {
    sellerId: { $in: sellerIds },
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.subcategoryId ? { subcategoryId: query.subcategoryId } : {}),
    ...(query.approvalStatus ? { approvalStatus: query.approvalStatus } : {}),
    ...(query.q ? { $or: [
      { name: { $regex: escapeRegExp(query.q), $options: 'i' } },
      { description: { $regex: escapeRegExp(query.q), $options: 'i' } },
    ] } : {}),
    ...(query.sellerId ? { sellerId: new mongoose.Types.ObjectId(query.sellerId) } : {}),
    ...(query.listingStatus === 'active' ? { isActive: true, isArchived: false } : {}),
    ...(query.listingStatus === 'inactive' ? { isActive: false, isArchived: false } : {}),
    ...(query.listingStatus === 'archived' ? { isArchived: true } : {}),
    ...(query.stockStatus === 'low_stock' ? { $expr: {
      $cond: [
        { $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] },
        { $anyElementTrue: { $map: { input: { $ifNull: ['$variants', []] }, as: 'variant', in: { $lte: ['$$variant.stock', '$lowStockThreshold'] } } } },
        { $lte: ['$stock', '$lowStockThreshold'] },
      ],
    } } : {}),
    ...(query.stockStatus === 'out_of_stock' ? { $expr: {
      $cond: [
        { $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] },
        { $eq: [{ $sum: { $map: { input: { $ifNull: ['$variants', []] }, as: 'variant', in: '$$variant.stock' } } }, 0] },
        { $eq: ['$stock', 0] },
      ],
    } } : {}),
  };
  const [products, total] = await Promise.all([
    Product.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
    Product.countDocuments(filter),
  ]);
  const productIds = products.map((product) => product._id);
  const [reservations, flagStats] = await Promise.all([
    productIds.length ? Order.find({
      'address.city': cityFilter(city),
      'items.productId': { $in: productIds },
      'items.sellerId': { $in: sellerIds },
      reservationExpiresAt: { $gt: new Date() },
      fulfilmentStatus: { $in: ['placed', 'order_confirmed', 'accepted'] },
      paymentStatus: { $ne: 'confirmed' },
    }).select('items.productId items.sellerId items.quantity').lean() : Promise.resolve([]),
    productIds.length ? CityAdminProductFlag.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
      { $match: { productId: { $in: productIds }, city: cityFilter(city), status: 'open' } },
      { $group: { _id: '$productId', count: { $sum: 1 } } },
    ]) : Promise.resolve([]),
  ]);
  const reservedByProduct = new Map<string, number>();
  for (const order of reservations) {
    for (const item of order.items) {
      const productId = String(item.productId);
      if (productIds.some((id) => String(id) === productId) && item.sellerId && sellerIds.some((id) => String(id) === String(item.sellerId))) {
        reservedByProduct.set(productId, (reservedByProduct.get(productId) ?? 0) + item.quantity);
      }
    }
  }
  const openFlagsByProduct = new Map(flagStats.map((entry) => [String(entry._id), entry.count]));
  const sellerNames = new Map(sellers.map((seller) => [String(seller._id), seller.name || seller.phoneE164 || 'Seller']));
  sendPage(res, products.map((product) => ({
    ...product,
    sellerName: product.sellerId ? sellerNames.get(String(product.sellerId)) ?? 'Seller' : 'Unassigned',
    availableStock: product.variants.length ? product.variants.reduce((sum, variant) => sum + variant.stock, 0) : product.stock,
    reservedStock: reservedByProduct.get(String(product._id)) ?? 0,
    openFlagCount: openFlagsByProduct.get(String(product._id)) ?? 0,
    category: product.categoryName ?? product.category,
    approvalStatus: product.approvalStatus,
    classificationStatus: product.classificationStatus,
    isFoodProduct: product.isFoodProduct,
    foodComplianceStatus: product.foodComplianceStatus,
  })), query.page, query.limit, total);
};

export const reviewCityAdminProduct: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const { productId } = z.object({ productId: z.string().regex(/^[a-f\d]{24}$/i) }).parse(req.params);
  const input = z.object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().trim().max(1000).optional(),
    categoryId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    subcategoryId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    productType: z.string().trim().min(1).max(160).optional(),
  }).strict().superRefine((value, context) => {
    if (value.decision === 'rejected' && !value.note) {
      context.addIssue({ code: 'custom', path: ['note'], message: 'A rejection reason is required.' });
    }
    const classificationFields = [value.categoryId, value.subcategoryId, value.productType];
    if (classificationFields.some((field) => field !== undefined) && classificationFields.some((field) => field === undefined)) {
      context.addIssue({ code: 'custom', path: ['categoryId'], message: 'Category, subcategory, and product type must be supplied together.' });
    }
  }).parse(req.body);
  const actorId = authenticatedUserId(req);
  const sellers = await findCitySellers(city);
  const product = await Product.findOne({ _id: productId, sellerId: { $in: sellers.map((seller) => seller._id) } });
  if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found in your assigned city.');

  const selection = getCategorySelection(
    input.categoryId ?? product.categoryId ?? '',
    input.subcategoryId ?? product.subcategoryId ?? '',
    input.productType ?? product.productType ?? '',
  );
  const classificationChanged = input.categoryId !== undefined;
  if (input.decision === 'approved') {
    if (!selection) {
      throw new AppError(409, 'PRODUCT_CLASSIFICATION_REQUIRED', 'Choose a valid category, subcategory, and product type before approval.');
    }
    if (product.classificationStatus === 'needs_review' && !classificationChanged) {
      throw new AppError(409, 'PRODUCT_CLASSIFICATION_REQUIRED', 'Resolve the product category classification before approval.');
    }
  }
  let hasVerifiedFoodApplication = false;
  if (selection?.isFoodProduct) {
    const verifiedApplication = product.sellerId ? await SellerApplication.findOne({
      sellerId: product.sellerId,
      city: cityFilter(city),
      status: 'approved',
      fssaiStatus: 'verified',
      fssaiRegistrationNumber: /^\d{14}$/,
    }).select('_id').lean() : null;
    hasVerifiedFoodApplication = Boolean(verifiedApplication);
    if (input.decision === 'approved' && !hasVerifiedFoodApplication) {
      throw new AppError(409, 'FSSAI_VERIFICATION_REQUIRED', 'Food products require a verified FSSAI seller registration before classification or approval.');
    }
  }

  const session = await mongoose.startSession();
  let updatedProduct;
  try {
    updatedProduct = await session.withTransaction(async () => {
      if (classificationChanged && selection) {
        product.category = selection.categoryName;
        product.categoryId = selection.categoryId;
        product.categoryName = selection.categoryName;
        product.subcategoryId = selection.subcategoryId;
        product.subcategoryName = selection.subcategoryName;
        product.productType = selection.productType;
        product.isFoodProduct = selection.isFoodProduct;
        product.classificationStatus = 'classified';
        product.classificationNote = null;
        product.foodComplianceStatus = selection.isFoodProduct
          ? hasVerifiedFoodApplication ? 'verified' : 'pending'
          : 'not_required';
      }
      product.approvalStatus = input.decision;
      product.isActive = input.decision === 'approved';
      if (input.decision === 'approved') {
        product.isArchived = false;
        product.classificationStatus = 'classified';
        product.classificationNote = null;
        if (selection?.isFoodProduct) product.foodComplianceStatus = 'verified';
      }
      await product.save({ session });
      await AuditLog.create([{
        actorId,
        action: `product.city_admin_${input.decision}`,
        resourceType: 'product',
        resourceId: productId,
        metadata: { city, ...(input.note ? { note: input.note } : {}), isFoodProduct: product.isFoodProduct },
      }], { session });
      return product;
    });
  } finally {
    await session.endSession();
  }
  if (!updatedProduct) throw new AppError(500, 'INTERNAL_ERROR', 'The product review could not be saved.');
  sendData(res, {
    productId,
    approvalStatus: updatedProduct.approvalStatus,
    isActive: updatedProduct.isActive,
  });
};

export const flagCityAdminProduct: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const { productId } = z.object({ productId: z.string().regex(/^[a-f\d]{24}$/i) }).parse(req.params);
  const { reason } = z.object({ reason: z.string().trim().min(10).max(1000) }).strict().parse(req.body);
  const actorId = authenticatedUserId(req);
  const sellers = await findCitySellers(city);
  const product = await Product.findOne({ _id: productId, sellerId: { $in: sellers.map((seller) => seller._id) } }).select('_id').lean();
  if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found in your assigned city.');

  const session = await mongoose.startSession();
  let flag;
  try {
    flag = await session.withTransaction(async () => {
      const [created] = await CityAdminProductFlag.create([{ productId, city, reportedBy: actorId, reason }], { session });
      if (!created) throw new AppError(500, 'INTERNAL_ERROR', 'The product flag could not be saved.');
      await AuditLog.create([{
        actorId,
        action: 'product.city_admin_flagged',
        resourceType: 'product',
        resourceId: productId,
        metadata: { city, flagId: created.id },
      }], { session });
      return created;
    });
  } finally {
    await session.endSession();
  }
  if (!flag) throw new AppError(500, 'INTERNAL_ERROR', 'The product flag could not be saved.');
  sendData(res, { id: flag.id, productId, status: flag.status, createdAt: flag.createdAt }, 201);
};

export const createCityAdminServiceZoneChangeRequest: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const { requestText } = z.object({ requestText: z.string().trim().min(10).max(1000) }).strict().parse(req.body);
  const actorId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let createdRequest;
  try {
    createdRequest = await session.withTransaction(async () => {
      const [requestRecord] = await ServiceZoneChangeRequest.create([{ city, requestedBy: actorId, requestText }], { session });
      if (!requestRecord) throw new AppError(500, 'INTERNAL_ERROR', 'The service-zone change request could not be created.');
      await AuditLog.create([{
        actorId,
        action: 'service_zone.change_requested',
        resourceType: 'service_zone_change_request',
        resourceId: requestRecord.id,
        metadata: { city },
      }], { session });
      return requestRecord;
    });
  } finally {
    await session.endSession();
  }
  if (!createdRequest) throw new AppError(500, 'INTERNAL_ERROR', 'The service-zone change request could not be saved.');
  sendData(res, { id: createdRequest.id, city, status: createdRequest.status, createdAt: createdRequest.createdAt }, 201);
};

function startOfCityDay(now = new Date()): Date {
  const cityDate = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(cityDate.getUTCFullYear(), cityDate.getUTCMonth(), cityDate.getUTCDate()) - 330 * 60_000);
}

export const listCityAdminOrders: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const query = orderQuerySchema.parse(req.query);
  const filter: Record<string, unknown> = {
    'address.city': cityFilter(city),
    ...(query.fulfilmentStatus ? { fulfilmentStatus: query.fulfilmentStatus } : {}),
    ...(query.deliveryStatus ? { deliveryStatus: query.deliveryStatus } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.sellerId ? { 'items.sellerId': new mongoose.Types.ObjectId(query.sellerId) } : {}),
    ...(query.deliveryPartnerId ? { 'deliveryPartner.userId': new mongoose.Types.ObjectId(query.deliveryPartnerId) } : {}),
    ...(query.from || query.to ? { createdAt: {
      ...(query.from ? { $gte: new Date(query.from) } : {}),
      ...(query.to ? { $lte: new Date(query.to) } : {}),
    } } : {}),
  };
  if (query.unassignedOnly === 'true') {
    Object.assign(filter, {
      fulfilmentMethod: 'delivery',
      fulfilmentStatus: query.fulfilmentStatus ? query.fulfilmentStatus : { $in: activeAssignmentStatuses },
      'deliveryPartner.name': { $exists: false },
    });
  }
  if (query.q) {
    const search = escapeRegExp(query.q);
    filter.$or = [
      { orderReference: { $regex: search, $options: 'i' } },
      { customerName: { $regex: search, $options: 'i' } },
    ];
  }
  const [orders, total, citySellers] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .select('orderReference customerName customerPhoneE164 items.productId items.sellerId items.productName items.quantity subtotalPaise deliveryFeePaise totalPaise paymentMethod paymentStatus fulfilmentMethod fulfilmentStatus deliveryPartner.userId deliveryPartner.name deliveryPartner.phoneE164 deliveryPartner.distanceKm deliveryPartner.assignedAt address sellerPickup preDispatchInspection returnRequest statusHistory deliveryStatus deliveryExceptions adminResolution createdAt')
      .lean(),
    Order.countDocuments(filter),
    findCitySellers(city),
  ]);
  const sellerNames = new Map(citySellers.map((seller) => [String(seller._id), seller.name || seller.phoneE164 || 'Seller']));
  const enriched = await Promise.all(orders.map(async (order) => {
    const sellerPickup = await resolveOrderSellerPickup(order);
    return {
      ...order,
      sellerPickup,
      items: order.items.map((item) => ({ ...item, sellerName: item.sellerId ? sellerNames.get(item.sellerId.toString()) || sellerPickup.sellerName || 'Seller' : undefined })),
    };
  }));
  sendPage(res, enriched, query.page, query.limit, total);
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const listCityAdminRemittanceSummary: RequestHandler = async (req, res) => {
  const adminId = authenticatedUserId(req);
  const city = req.user?.assignedCity?.trim() || 'Damoh';
  const partners = await User.find({
    role: 'delivery_partner',
    status: 'active',
    $or: [{ assignedCity: new RegExp(`^${escapeRegExp(city)}$`, 'i') }, { assignedCity: 'Damoh' }],
  }).select('_id name phoneE164 isOnline availabilityStatus remittancePin').lean();

  const partnerIds = partners.map((p) => p._id);
  const unremittedOrders = await Order.find({
    'deliveryPartner.userId': { $in: partnerIds },
    fulfilmentStatus: { $in: ['delivered', 'completed'] },
    $or: [
      { paymentMethod: 'cash' },
      { 'doorstepPayment.mode': 'cash' },
    ],
    'doorstepPayment.remittedToCityAdmin': { $ne: true },
  }).select('_id orderReference totalPaise customerName deliveryPartner.userId doorstepPayment updatedAt').lean();

  const ordersByPartner = new Map<string, typeof unremittedOrders>();
  for (const o of unremittedOrders) {
    const pId = String(o.deliveryPartner?.userId);
    if (!ordersByPartner.has(pId)) ordersByPartner.set(pId, []);
    ordersByPartner.get(pId)!.push(o);
  }

  const summaries = partners.map((p) => {
    const pOrders = ordersByPartner.get(String(p._id)) || [];
    const unremittedCashPaise = pOrders.reduce((acc, curr) => acc + (curr.totalPaise || 0), 0);
    return {
      partnerId: String(p._id),
      name: p.name || 'Delivery Partner',
      phoneE164: p.phoneE164,
      isOnline: p.isOnline ?? true,
      availabilityStatus: p.availabilityStatus ?? 'available',
      unremittedCashPaise,
      unremittedCashRupees: (unremittedCashPaise / 100).toFixed(2),
      orderCount: pOrders.length,
      orders: pOrders.map((o) => ({
        orderId: String(o._id),
        orderReference: o.orderReference,
        customerName: o.customerName,
        totalPaise: o.totalPaise,
        totalRupees: ((o.totalPaise || 0) / 100).toFixed(2),
      })),
      exceedsThreshold: unremittedCashPaise > 200000,
    };
  });

  const totalOutstandingPaise = summaries.reduce((acc, s) => acc + s.unremittedCashPaise, 0);
  const recentVouchers = await CashRemittance.find({ city: new RegExp(`^${escapeRegExp(city)}$`, 'i') })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  sendData(res, {
    city,
    totalOutstandingPaise,
    totalOutstandingRupees: (totalOutstandingPaise / 100).toFixed(2),
    thresholdLimitRupees: '2000.00',
    partners: summaries,
    recentVouchers: recentVouchers.map((v) => ({
      _id: String(v._id),
      receiptNumber: v.receiptNumber,
      riderName: v.riderName,
      riderPhone: v.riderPhone,
      amountRupees: (v.amountPaise / 100).toFixed(2),
      orderCount: v.orderReferences?.length || 0,
      orderReferences: v.orderReferences,
      handshakePinUsed: v.handshakePinUsed,
      settledByAdminName: v.settledByAdminName,
      settledAt: v.settledAt,
    })),
  });
};

const settleRemittanceSchema = z.object({
  partnerId: z.string().regex(/^[a-f\d]{24}$/i),
  amountPaise: z.number().int().min(0),
  handshakePin: z.string().trim().length(4),
  notes: z.string().trim().max(500).optional(),
}).strict();

export const settleCityAdminCashRemittance: RequestHandler = async (req, res) => {
  const adminId = authenticatedUserId(req);
  const city = req.user?.assignedCity?.trim() || 'Damoh';
  const adminUser = await User.findById(adminId).select('name phoneE164').lean();
  const input = settleRemittanceSchema.parse(req.body);

  const partner = await User.findOne({
    _id: input.partnerId,
    role: 'delivery_partner',
  });
  if (!partner) throw new AppError(404, 'NOT_FOUND', 'Delivery partner not found.');

  // Validate Handshake PIN against active 60s window or 30s grace window
  const enteredPin = input.handshakePin.trim();
  const now = new Date();
  const pinExpiresAt = (partner as any).remittancePinExpiresAt ? new Date((partner as any).remittancePinExpiresAt) : null;
  const prevPinExpiresAt = (partner as any).previousPinExpiresAt ? new Date((partner as any).previousPinExpiresAt) : null;

  let isValid = false;
  if (partner.remittancePin && partner.remittancePin === enteredPin) {
    if (!pinExpiresAt || pinExpiresAt.getTime() > now.getTime()) {
      isValid = true;
    }
  }

  if (!isValid && (partner as any).previousRemittancePin && (partner as any).previousRemittancePin === enteredPin) {
    if (prevPinExpiresAt && prevPinExpiresAt.getTime() > now.getTime()) {
      isValid = true;
    }
  }

  if (!isValid) {
    if (partner.remittancePin === enteredPin && pinExpiresAt && pinExpiresAt.getTime() <= now.getTime()) {
      throw new AppError(400, 'EXPIRED_HANDSHAKE_PIN', 'The Handshake PIN has expired. For security, PINs auto-refresh every 60 seconds. Please ask the partner for the new PIN on their screen.');
    }
    throw new AppError(400, 'INVALID_HANDSHAKE_PIN', 'Invalid 4-digit Handshake PIN. Please ask the delivery partner for the live PIN displayed on their active phone screen.');
  }

  const unremittedOrders = await Order.find({
    'deliveryPartner.userId': partner._id,
    fulfilmentStatus: { $in: ['delivered', 'completed'] },
    $or: [
      { paymentMethod: 'cash' },
      { 'doorstepPayment.mode': 'cash' },
    ],
    'doorstepPayment.remittedToCityAdmin': { $ne: true },
  });

  if (!unremittedOrders.length) {
    throw new AppError(400, 'NO_UNREMITTED_CASH', 'No outstanding cash on delivery orders found for this partner.');
  }

  const totalCalculatedPaise = unremittedOrders.reduce((sum, o) => sum + (o.totalPaise || 0), 0);
  const receiptNumber = `REM-${city.toUpperCase().slice(0, 3)}-${Date.now().toString().slice(-6)}`;

  const orderIds = unremittedOrders.map((o) => o._id);
  const orderReferences = unremittedOrders.map((o) => o.orderReference);

  await Order.updateMany(
    { _id: { $in: orderIds } },
    {
      $set: {
        'doorstepPayment.remittedToCityAdmin': true,
        'doorstepPayment.remittedAt': now,
        'doorstepPayment.remittedReceiptNumber': receiptNumber,
        'doorstepPayment.receivedByAdminId': adminId,
      },
    },
  );

  // Invalidate and rotate partner's PIN immediately for next session
  partner.remittancePin = String(Math.floor(1000 + Math.random() * 9000));
  (partner as any).remittancePinExpiresAt = new Date(now.getTime() + 60_000);
  (partner as any).previousRemittancePin = undefined;
  (partner as any).previousPinExpiresAt = undefined;
  await partner.save();

  const voucher = await CashRemittance.create({
    receiptNumber,
    riderId: partner._id,
    riderName: partner.name || 'Delivery Partner',
    riderPhone: partner.phoneE164,
    city,
    amountPaise: totalCalculatedPaise,
    orderIds,
    orderReferences,
    settledByAdminId: adminId,
    settledByAdminName: adminUser?.name || 'City Admin',
    handshakePinUsed: input.handshakePin,
    method: 'physical_hub_cash',
    notes: input.notes || 'In-person physical cash drop verified at City Admin desk',
    settledAt: now,
  });

  await AuditLog.create([{
    actorType: 'user',
    actorId: adminId,
    action: 'CASH_REMITTANCE_SETTLED',
    resourceType: 'cash_remittance',
    resourceId: String(voucher._id),
    metadata: {
      receiptNumber,
      partnerId: String(partner._id),
      partnerName: partner.name,
      amountRupees: (totalCalculatedPaise / 100).toFixed(2),
      orderCount: orderIds.length,
    },
  }]);

  sendData(res, {
    success: true,
    receiptNumber,
    settledAmountPaise: totalCalculatedPaise,
    settledAmountRupees: (totalCalculatedPaise / 100).toFixed(2),
    settledOrdersCount: orderIds.length,
    voucherId: String(voucher._id),
    settledAt: now,
  });
};
