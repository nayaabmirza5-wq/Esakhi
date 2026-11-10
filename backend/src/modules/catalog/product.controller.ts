import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AuditLog } from '../audit/auditLog.model.js';
import { User } from '../auth/user.model.js';
import { sendData, sendPage } from '../../utils/apiResponse.js';
import { AppError } from '../../utils/AppError.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { Order } from '../orders/order.model.js';
import { SellerApplication } from '../seller/sellerApplication.model.js';
import { categoryMaster, getCategoryHierarchy, getCategorySelection, isKnownProductType } from './categoryMaster.js';
import { Product } from './product.model.js';
import { bestSellerQuerySchema, idParamsSchema, productCreateSchema, productListQuerySchema, productUpdateSchema, sellerProductCreateSchema, slugParamsSchema } from './product.schemas.js';

const publishedProductFilter = {
  isActive: true,
  isArchived: false,
  approvalStatus: 'approved' as const,
  classificationStatus: 'classified' as const,
  $or: [
    { isFoodProduct: false },
    { isFoodProduct: true, foodComplianceStatus: 'verified' as const },
  ],
};

const productSorts = {
  newest: { createdAt: -1, _id: -1 },
  price_asc: { pricePaise: 1, _id: 1 },
  price_desc: { pricePaise: -1, _id: -1 },
} as const;

type SellerLinkedProduct = { _id: unknown; sellerId?: unknown; [key: string]: unknown };

async function addPublicSellerNames<T extends SellerLinkedProduct>(products: T[]) {
  const sellerIds = [...new Set(products.flatMap((product) => product.sellerId ? [String(product.sellerId)] : []))];
  if (!sellerIds.length) return products.map((product) => ({ ...product, productId: String(product._id), sellerName: null }));

  const sellers = await User.find({ _id: { $in: sellerIds } }).select('name phoneE164').lean();
  const sellerById = new Map(sellers.map((seller) => [String(seller._id), seller]));
  const phoneNumbers = sellers.map((seller) => seller.phoneE164);
  const applications = await SellerApplication.find({
    status: 'approved',
    $or: [
      { sellerId: { $in: sellerIds } },
      { phoneE164: { $in: phoneNumbers } },
    ],
  }).select('sellerId phoneE164 shgName').sort({ reviewedAt: -1 }).lean();
  const shgNameBySellerId = new Map<string, string>();
  const sellerIdByPhone = new Map(sellers.map((seller) => [seller.phoneE164, String(seller._id)]));
  for (const application of applications) {
    const sellerId = application.sellerId ? String(application.sellerId) : sellerIdByPhone.get(application.phoneE164);
    if (sellerId && !shgNameBySellerId.has(sellerId)) shgNameBySellerId.set(sellerId, application.shgName);
  }

  return products.map((product) => {
    const sellerId = product.sellerId ? String(product.sellerId) : null;
    const seller = sellerId ? sellerById.get(sellerId) : undefined;
    return {
      ...product,
      productId: String(product._id),
      sellerName: sellerId ? shgNameBySellerId.get(sellerId) ?? seller?.name ?? null : null,
    };
  });
}

async function isFoodSellerVerified(sellerId: string | mongoose.Types.ObjectId | null | undefined, session?: mongoose.ClientSession): Promise<boolean> {
  if (!sellerId) return false;
  const seller = await User.findById(sellerId).select('phoneE164').session(session ?? null).lean();
  const application = SellerApplication.findOne({
    $or: [
      { sellerId },
      ...(seller?.phoneE164 ? [{ phoneE164: seller.phoneE164 }] : []),
    ],
    status: 'approved',
    fssaiStatus: 'verified',
    fssaiRegistrationNumber: /^\d{14}$/,
  }).select('_id');
  if (session) application.session(session);
  return Boolean(await application.lean());
}

async function resolveUniqueProductSlug(baseSlug: string, session?: mongoose.ClientSession, excludeId?: string): Promise<string> {
  const normalizedBase = baseSlug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product';
  let candidate = normalizedBase.slice(0, 180);
  let counter = 2;
  while (true) {
    const filter: Record<string, unknown> = { slug: candidate };
    if (excludeId) filter._id = { $ne: excludeId };
    const query = Product.findOne(filter).select('_id');
    if (session) query.session(session);
    const existing = await query.lean();
    if (!existing) return candidate;
    const suffix = `-${counter}`;
    candidate = `${normalizedBase.slice(0, Math.max(1, 180 - suffix.length)).replace(/-+$/, '')}${suffix}`;
    counter += 1;
  }
}

function assertFoodPublicationAllowed(isFoodProduct: boolean, foodComplianceStatus: string, isActive: boolean): void {
  if (isActive && isFoodProduct && foodComplianceStatus !== 'verified') {
    throw new AppError(409, 'FSSAI_VERIFICATION_REQUIRED', 'Verify the seller’s FSSAI details before publishing a food product.');
  }
}

export const listProducts: RequestHandler = async (req, res) => {
  const query = productListQuerySchema.parse(req.query);
  const filter = {
    ...publishedProductFilter,
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.subcategoryId ? { subcategoryId: query.subcategoryId } : {}),
    ...(query.q ? {
      $or: [
        { name: { $regex: query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { productType: { $regex: query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { description: { $regex: query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { categoryName: { $regex: query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { subcategoryName: { $regex: query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      ],
    } : {}),
  };
  const [products, total] = await Promise.all([
    Product.find(filter)
      .select('sellerId name slug description category categoryId categoryName subcategoryId subcategoryName productType isFoodProduct pricePaise imageUrls variants stock')
      .sort(productSorts[query.sort])
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<SellerLinkedProduct[]>(),
    Product.countDocuments(filter),
  ]);
  sendPage(res, await addPublicSellerNames(products), query.page, query.limit, total);
};

export const listBestSellingProducts: RequestHandler = async (req, res) => {
  const { limit } = bestSellerQuerySchema.parse(req.query);
  const bestSellers = await Order.aggregate<SellerLinkedProduct>([
    { $match: { paymentStatus: 'confirmed', fulfilmentStatus: { $ne: 'cancelled' } } },
    { $unwind: '$items' },
    { $group: { _id: '$items.productId', unitsPurchased: { $sum: '$items.quantity' } } },
    { $sort: { unitsPurchased: -1, _id: 1 } },
    {
      $lookup: {
        from: Product.collection.name,
        localField: '_id',
        foreignField: '_id',
        as: 'product',
      },
    },
    { $unwind: '$product' },
    {
      $match: {
        'product.isActive': true,
        'product.isArchived': false,
        'product.approvalStatus': 'approved',
        'product.classificationStatus': 'classified',
        $or: [
          { 'product.isFoodProduct': false },
          { 'product.isFoodProduct': true, 'product.foodComplianceStatus': 'verified' },
        ],
      },
    },
    {
      $project: {
        _id: '$product._id',
        sellerId: '$product.sellerId',
        name: '$product.name',
        slug: '$product.slug',
        description: '$product.description',
        category: '$product.category',
        categoryId: '$product.categoryId',
        categoryName: '$product.categoryName',
        subcategoryId: '$product.subcategoryId',
        subcategoryName: '$product.subcategoryName',
        productType: '$product.productType',
        isFoodProduct: '$product.isFoodProduct',
        pricePaise: '$product.pricePaise',
        imageUrls: '$product.imageUrls',
        variants: '$product.variants',
        stock: '$product.stock',
      },
    },
    { $limit: limit },
  ]);
  const remaining = limit - bestSellers.length;
  const recentProducts = remaining > 0
    ? await Product.find({
      ...publishedProductFilter,
      ...(bestSellers.length ? { _id: { $nin: bestSellers.map((product) => product._id) } } : {}),
    })
      .select('sellerId name slug description category categoryId categoryName subcategoryId subcategoryName productType isFoodProduct pricePaise imageUrls variants stock')
      .sort({ createdAt: -1, _id: -1 })
      .limit(remaining)
      .lean<SellerLinkedProduct[]>()
    : [];
  sendData(res, await addPublicSellerNames([...bestSellers, ...recentProducts]));
};

export const getProductBySlug: RequestHandler = async (req, res) => {
  const { slug } = slugParamsSchema.parse(req.params);
  const product = await Product.findOne({ ...publishedProductFilter, slug })
    .select('sellerId name slug description category categoryId categoryName subcategoryId subcategoryName productType isFoodProduct pricePaise imageUrls variants stock')
    .lean<SellerLinkedProduct | null>();
  if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found.');
  const [withSellerName] = await addPublicSellerNames([product]);
  sendData(res, withSellerName);
};

export const listAllProductsForAdmin: RequestHandler = async (req, res) => {
  const query = productListQuerySchema.extend({
    active: zBooleanQuery.active.optional(),
    archived: zBooleanQuery.archived.optional(),
    sellerId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  }).parse(req.query);
  const filter = {
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.subcategoryId ? { subcategoryId: query.subcategoryId } : {}),
    ...(query.q ? {
      $or: [
        { name: { $regex: query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { productType: { $regex: query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { description: { $regex: query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { categoryName: { $regex: query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { subcategoryName: { $regex: query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      ],
    } : {}),
    ...(query.active === undefined ? {} : { isActive: query.active }),
    ...(query.archived === undefined ? {} : { isArchived: query.archived }),
    ...(query.sellerId ? { sellerId: new mongoose.Types.ObjectId(query.sellerId) } : {}),
  };
  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort(productSorts[query.sort])
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Product.countDocuments(filter),
  ]);
  sendPage(res, products, query.page, query.limit, total);
};

export const getAdminProduct: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const product = await Product.findById(id).lean();
  if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found.');
  sendData(res, product);
};

const zBooleanQuery = {
  active: z.enum(['true', 'false']).transform((value) => value === 'true'),
  archived: z.enum(['true', 'false']).transform((value) => value === 'true'),
};

export const createProduct: RequestHandler = async (req, res) => {
  const input = productCreateSchema.parse(req.body);
  const selection = getCategorySelection(input.categoryId, input.subcategoryId, input.productType);
  if (!selection) throw new AppError(400, 'INVALID_CATEGORY_HIERARCHY', 'Choose a category and subcategory from the shared category master.');
  const actorId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let product: InstanceType<typeof Product> | null = null;
  try {
    product = await session.withTransaction(async () => {
      const { sellerId, categoryId, subcategoryId, productType, isActive, basePricePaise, ...productFields } = input;
      const basePrice = basePricePaise ?? Math.round(productFields.pricePaise / 1.10);
      const platformFee = Math.round(basePrice * 0.05);
      const cityAdminFee = Math.round(basePrice * 0.05);
      const uniqueSlug = await resolveUniqueProductSlug(productFields.slug, session);
      const foodComplianceStatus = selection.isFoodProduct
        ? (await isFoodSellerVerified(sellerId, session) ? 'verified' : 'pending')
        : 'not_required';
      assertFoodPublicationAllowed(selection.isFoodProduct, foodComplianceStatus, isActive);
      const [created] = await Product.create([{
        ...productFields,
        basePricePaise: basePrice,
        platformFeePaise: platformFee,
        cityAdminFeePaise: cityAdminFee,
        slug: uniqueSlug,
        category: selection.categoryName,
        ...selection,
        sellerId: sellerId ? new mongoose.Types.ObjectId(sellerId) : null,
        isActive,
        classificationStatus: 'classified',
        approvalStatus: isActive ? 'approved' : 'pending',
        foodComplianceStatus,
      }], { session });
      if (!created) throw new AppError(500, 'INTERNAL_ERROR', 'The product could not be created.');
      await AuditLog.create([{
        actorId,
        action: 'product.created',
        resourceType: 'product',
        resourceId: String(created.id),
        metadata: { categoryId: selection.categoryId, subcategoryId: selection.subcategoryId, isFoodProduct: selection.isFoodProduct },
      }], { session });
      return created;
    });
  } finally {
    await session.endSession();
  }
  if (!product) throw new AppError(500, 'INTERNAL_ERROR', 'The product could not be created.');
  sendData(res, product, 201);
};

export const createSellerProduct: RequestHandler = async (req, res) => {
  const input = sellerProductCreateSchema.parse(req.body);
  const selection = getCategorySelection(input.categoryId, input.subcategoryId, input.productType);
  if (!selection) throw new AppError(400, 'INVALID_CATEGORY_HIERARCHY', 'Choose a category and subcategory from the shared category master.');
  const sellerId = authenticatedUserId(req);
  const actorId = sellerId;
  const session = await mongoose.startSession();
  let product: InstanceType<typeof Product> | null = null;
  try {
    product = await session.withTransaction(async () => {
      const foodVerified = selection.isFoodProduct && await isFoodSellerVerified(sellerId, session);
      if (selection.isFoodProduct && !foodVerified) {
        throw new AppError(409, 'FSSAI_VERIFICATION_REQUIRED', 'Food listings require an approved seller application with verified FSSAI details.');
      }
      const knownProductType = isKnownProductType(selection.categoryId, selection.subcategoryId, selection.productType);
      const uniqueSlug = await resolveUniqueProductSlug(input.slug, session);
      const { basePricePaise: inputBasePrice, pricePaise: _ignoredPrice, ...sellerFields } = input;
      const basePricePaise = inputBasePrice ?? Math.round(input.pricePaise / 1.10);
      const platformFeePaise = Math.round(basePricePaise * 0.05);
      const cityAdminFeePaise = Math.round(basePricePaise * 0.05);
      const finalPricePaise = input.pricePaise || (basePricePaise + platformFeePaise + cityAdminFeePaise);

      const [created] = await Product.create([{
        pricePaise: finalPricePaise,
        basePricePaise,
        platformFeePaise,
        cityAdminFeePaise,
        ...sellerFields,
        slug: uniqueSlug,
        category: selection.categoryName,
        ...selection,
        sellerId: new mongoose.Types.ObjectId(sellerId),
        isActive: false,
        classificationStatus: knownProductType ? 'classified' : 'needs_review',
        ...(knownProductType ? {} : { classificationNote: 'Seller-selected product type requires City Admin classification review.' }),
        approvalStatus: 'pending',
        foodComplianceStatus: selection.isFoodProduct ? 'verified' : 'not_required',
      }], { session });
      if (!created) throw new AppError(500, 'INTERNAL_ERROR', 'The seller product could not be created.');
      await AuditLog.create([{
        actorId,
        action: 'product.seller_submitted',
        resourceType: 'product',
        resourceId: String(created.id),
        metadata: { categoryId: selection.categoryId, subcategoryId: selection.subcategoryId, isFoodProduct: selection.isFoodProduct },
      }], { session });
      return created;
    });
  } finally {
    await session.endSession();
  }
  if (!product) throw new AppError(500, 'INTERNAL_ERROR', 'The seller product could not be created.');
  sendData(res, product, 201);
};

export const updateProduct: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const input = productUpdateSchema.parse(req.body);
  const actorId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let product;
  try {
    product = await session.withTransaction(async () => {
      const existing = await Product.findOne({ _id: id, isArchived: false }).session(session);
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Product not found.');
      const sellerId = input.sellerId ?? (existing.sellerId ? String(existing.sellerId) : undefined);
      const hierarchyChanged = input.categoryId !== undefined || input.subcategoryId !== undefined || input.productType !== undefined;
      let selection;
      if (hierarchyChanged) {
        selection = getCategorySelection(
          input.categoryId ?? existing.categoryId ?? '',
          input.subcategoryId ?? existing.subcategoryId ?? '',
          input.productType ?? existing.productType ?? '',
        );
        if (!selection) throw new AppError(400, 'INVALID_CATEGORY_HIERARCHY', 'Choose a category and subcategory from the shared category master.');
      }
      const isFoodProduct = selection?.isFoodProduct ?? existing.isFoodProduct;
      const foodComplianceStatus = isFoodProduct
        ? (await isFoodSellerVerified(sellerId, session) ? 'verified' : existing.foodComplianceStatus)
        : 'not_required';
      const isActive = input.isActive ?? existing.isActive;
      assertFoodPublicationAllowed(isFoodProduct, foodComplianceStatus, isActive);
      const uniqueSlug = input.slug !== undefined && input.slug !== existing.slug
        ? await resolveUniqueProductSlug(input.slug, session, String(existing._id))
        : undefined;
      const changes = {
        ...input,
        ...(uniqueSlug ? { slug: uniqueSlug } : {}),
        ...(sellerId ? { sellerId: new mongoose.Types.ObjectId(sellerId) } : {}),
        ...(selection ? {
          category: selection.categoryName,
          categoryId: selection.categoryId,
          categoryName: selection.categoryName,
          subcategoryId: selection.subcategoryId,
          subcategoryName: selection.subcategoryName,
          productType: selection.productType,
          isFoodProduct: selection.isFoodProduct,
          classificationStatus: 'classified',
          classificationNote: null,
        } : {}),
        foodComplianceStatus,
        ...(input.isActive === true ? { approvalStatus: 'approved' } : {}),
      };
      existing.set(changes);
      await existing.save({ session });
      await AuditLog.create([{
        actorId,
        action: 'product.updated',
        resourceType: 'product',
        resourceId: String(existing.id),
        metadata: { changedFields: Object.keys(changes) },
      }], { session });
      return existing;
    });
  } finally {
    await session.endSession();
  }
  if (!product) throw new AppError(500, 'INTERNAL_ERROR', 'The product could not be updated.');
  sendData(res, product);
};

export const archiveProduct: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const actorId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let product;
  try {
    product = await session.withTransaction(async () => {
      const archived = await Product.findOneAndUpdate(
        { _id: id, isArchived: false },
        { $set: { isArchived: true, isActive: false } },
        { new: true, session },
      );
      if (!archived) throw new AppError(404, 'NOT_FOUND', 'Product not found.');
      await AuditLog.create([{
        actorId,
        action: 'product.archived',
        resourceType: 'product',
        resourceId: String(archived.id),
      }], { session });
      return archived;
    });
  } finally {
    await session.endSession();
  }
  if (!product) throw new AppError(500, 'INTERNAL_ERROR', 'The product could not be archived.');
  sendData(res, { id: product.id, isArchived: true });
};

export const categoriesController: RequestHandler = (_req, res) => {
  sendData(res, getCategoryHierarchy());
};
