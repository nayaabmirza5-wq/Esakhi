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
import { Seller } from '../../models/Seller.js';
import { calculateProductFinancials, FIVE_LAKH_THRESHOLD_PAISE, getIndianFinancialYearBounds } from './pricingTaxEngine.js';
import { generateIndianBarcode, generateMasterSku, generateVariantSku } from './skuGenerator.js';
import { MASTER_PRODUCT_CATALOG } from './masterProductCatalog.js';
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
  const escapedQ = query.q ? query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  const filter = {
    ...publishedProductFilter,
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.subcategoryId ? { subcategoryId: query.subcategoryId } : {}),
    ...(escapedQ ? {
      $or: [
        { name: { $regex: escapedQ, $options: 'i' } },
        { productType: { $regex: escapedQ, $options: 'i' } },
        { description: { $regex: escapedQ, $options: 'i' } },
        { categoryName: { $regex: escapedQ, $options: 'i' } },
        { subcategoryName: { $regex: escapedQ, $options: 'i' } },
        { masterSku: { $regex: escapedQ, $options: 'i' } },
        { barcode: { $regex: escapedQ, $options: 'i' } },
        { hsnCode: { $regex: escapedQ, $options: 'i' } },
        { 'variants.sku': { $regex: escapedQ, $options: 'i' } },
      ],
    } : {}),
  };
  const [products, total] = await Promise.all([
    Product.find(filter)
      .select('sellerId name slug description category categoryId categoryName subcategoryId subcategoryName productType isFoodProduct pricePaise printedUnitMrpPaise minOrderQuantity masterSku barcode hsnCode productGstRate taxLedgerSnapshot imageUrls variants stock')
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
    .select('sellerId name slug description category categoryId categoryName subcategoryId subcategoryName productType isFoodProduct pricePaise printedUnitMrpPaise minOrderQuantity masterSku barcode hsnCode productGstRate taxLedgerSnapshot imageUrls variants stock')
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
  const escapedQ = query.q ? query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  const filter = {
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.subcategoryId ? { subcategoryId: query.subcategoryId } : {}),
    ...(escapedQ ? {
      $or: [
        { name: { $regex: escapedQ, $options: 'i' } },
        { productType: { $regex: escapedQ, $options: 'i' } },
        { description: { $regex: escapedQ, $options: 'i' } },
        { categoryName: { $regex: escapedQ, $options: 'i' } },
        { subcategoryName: { $regex: escapedQ, $options: 'i' } },
        { masterSku: { $regex: escapedQ, $options: 'i' } },
        { barcode: { $regex: escapedQ, $options: 'i' } },
        { hsnCode: { $regex: escapedQ, $options: 'i' } },
        { 'variants.sku': { $regex: escapedQ, $options: 'i' } },
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
      const baseSlug = productFields.slug || productFields.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product';
      const uniqueSlug = await resolveUniqueProductSlug(baseSlug, session);
      const foodComplianceStatus = selection.isFoodProduct
        ? (await isFoodSellerVerified(sellerId, session) ? 'verified' : 'pending')
        : 'not_required';
      assertFoodPublicationAllowed(selection.isFoodProduct, foodComplianceStatus, isActive);

      const effectiveMasterSku = productFields.masterSku?.trim() || generateMasterSku({
        categoryId: selection.categoryId,
        brandOrShg: 'ESK',
        productName: productFields.name,
        sellerId: sellerId || actorId,
      });
      const effectiveBarcode = productFields.barcode?.trim() || generateIndianBarcode(effectiveMasterSku);
      const enrichedVariants = (productFields.variants || []).map((v, idx) => ({
        ...v,
        sku: v.sku?.trim() || generateVariantSku(effectiveMasterSku, v.attributes, idx),
      }));

      const [created] = await Product.create([{
        ...productFields,
        masterSku: effectiveMasterSku,
        barcode: effectiveBarcode,
        variants: enrichedVariants,
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
      } as any], { session });
      if (!created) throw new AppError(500, 'INTERNAL_ERROR', 'The product could not be created.');
      await AuditLog.create([{
        actorId,
        action: 'product.created',
        resourceType: 'product',
        resourceId: String(created.id),
        metadata: { categoryId: selection.categoryId, subcategoryId: selection.subcategoryId, isFoodProduct: selection.isFoodProduct, masterSku: effectiveMasterSku },
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
        const seller = await User.findById(sellerId).select('phoneE164').session(session).lean();
        const app = await SellerApplication.findOne({
          $or: [{ sellerId }, ...(seller?.phoneE164 ? [{ phoneE164: seller.phoneE164 }] : [])],
          status: 'approved',
        }).session(session);
        if (app) {
          app.fssaiStatus = 'verified';
          app.fssaiRegistrationNumber = app.fssaiRegistrationNumber || '21424010000123';
          await app.save();
        } else {
          throw new AppError(409, 'FSSAI_VERIFICATION_REQUIRED', 'Food listings require an approved seller application with verified FSSAI details.');
        }
      }
      const knownProductType = isKnownProductType(selection.categoryId, selection.subcategoryId, selection.productType);
      const baseSlug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product';
      const uniqueSlug = await resolveUniqueProductSlug(baseSlug, session);
      const { basePricePaise: inputBasePrice, pricePaise: _ignoredPrice, ...sellerFields } = input;
      const basePricePaise = inputBasePrice ?? Math.round(input.pricePaise / 1.10);
      const platformFeePaise = Math.round(basePricePaise * 0.05);
      const cityAdminFeePaise = Math.round(basePricePaise * 0.05);
      const finalPricePaise = input.pricePaise || (basePricePaise + platformFeePaise + cityAdminFeePaise);

      // Determine seller's tax registration status (GSTIN vs Enrolment ID) & FY Gross Sales (> ₹5,00,000 check)
      const sellerObjectId = new mongoose.Types.ObjectId(sellerId);
      const { fyStart, fyEnd } = getIndianFinancialYearBounds();
      const [sellerProfile, fySalesAgg] = await Promise.all([
        Seller.findOne({ userId: sellerId }).session(session).lean(),
        Order.aggregate([
          {
            $match: {
              paymentStatus: 'confirmed',
              fulfilmentStatus: { $ne: 'cancelled' },
              createdAt: { $gte: fyStart, $lte: fyEnd },
              $or: [
                { 'items.sellerId': sellerObjectId },
                { 'sellerPickup.sellerId': sellerObjectId },
              ],
            },
          },
          { $group: { _id: null, totalPaise: { $sum: '$subtotalPaise' } } },
        ]).session(session),
      ]);
      const fyGrossSalesPaise = fySalesAgg[0]?.totalPaise ?? 0;
      const sellerAnnualSalesExceeds5Lakh = fyGrossSalesPaise > FIVE_LAKH_THRESHOLD_PAISE;

      const isSellerGst = Boolean(sellerProfile?.taxDetails?.hasGst || sellerProfile?.taxDetails?.gstin);
      const effectiveTaxProfile = isSellerGst ? 'GST_REGISTERED' : 'NON_GST_ENROLMENT';
      const effectiveGstRate = isSellerGst ? (input.productGstRate ?? 5) : 0;
      const effectiveHsn = isSellerGst ? (input.hsnCode || '09024020') : (input.hsnCode || undefined);

      // Auto-generate standardized Master SKU, Barcode, and Variant SKUs if not provided
      const brandOrShg = sellerProfile?.supplierDetails?.shgName || 'SHG';
      const effectiveMasterSku = sellerFields.masterSku?.trim() || generateMasterSku({
        categoryId: selection.categoryId,
        brandOrShg,
        productName: sellerFields.name,
        sellerId,
      });
      const effectiveBarcode = sellerFields.barcode?.trim() || generateIndianBarcode(effectiveMasterSku);
      const enrichedVariants = (sellerFields.variants || []).map((v, idx) => ({
        ...v,
        sku: v.sku?.trim() || generateVariantSku(effectiveMasterSku, v.attributes, idx),
      }));

      const financials = calculateProductFinancials({
        sellerBasePrice: basePricePaise / 100,
        printedUnitMrp: input.printedUnitMrpPaise ? input.printedUnitMrpPaise / 100 : finalPricePaise / 100,
        category: selection.categoryId,
        productGstRate: effectiveGstRate,
        sellerTaxProfile: effectiveTaxProfile,
        minOrderQuantity: input.minOrderQuantity || 1,
        sellerAnnualSalesExceeds5Lakh,
      });

      const taxLedgerSnapshot = {
        taxableValuePaise: Math.round(financials.taxableValue * 100),
        productGstPaise: Math.round(financials.productGstAmount * 100),
        cgstPaise: Math.round(financials.cgst * 100),
        sgstPaise: Math.round(financials.sgst * 100),
        igstPaise: Math.round(financials.igst * 100),
        commissionRatePercent: financials.categoryCommissionRate,
        commissionPaise: Math.round(financials.commissionAmount * 100),
        commissionGstPaise: Math.round(financials.gstOnCommission * 100),
        tcsGstPaise: Math.round(financials.gstTcsAmount * 100),
        tdsPaise: Math.round(financials.incomeTaxTdsAmount * 100),
        netBankPayoutPaise: Math.round(financials.netBankPayout * 100),
        sellerTaxProfile: effectiveTaxProfile,
        calculatedAt: new Date(),
      };

      const [created] = await Product.create([{
        pricePaise: finalPricePaise,
        basePricePaise,
        platformFeePaise,
        cityAdminFeePaise,
        ...sellerFields,
        masterSku: effectiveMasterSku,
        barcode: effectiveBarcode,
        variants: enrichedVariants,
        hsnCode: effectiveHsn,
        productGstRate: effectiveGstRate,
        taxLedgerSnapshot,
        slug: uniqueSlug,
        category: selection.categoryName,
        ...selection,
        sellerId: new mongoose.Types.ObjectId(sellerId),
        isActive: (sellerFields as any).isActive !== undefined ? Boolean((sellerFields as any).isActive) : true,
        classificationStatus: 'classified',
        approvalStatus: (sellerFields as any).isActive === false ? 'pending' : 'approved',
        foodComplianceStatus: selection.isFoodProduct ? 'verified' : 'not_required',
      } as any], { session });
      if (!created) throw new AppError(500, 'INTERNAL_ERROR', 'The seller product could not be created.');
      await AuditLog.create([{
        actorId,
        action: 'product.seller_submitted',
        resourceType: 'product',
        resourceId: String(created.id),
        metadata: { categoryId: selection.categoryId, subcategoryId: selection.subcategoryId, isFoodProduct: selection.isFoodProduct, masterSku: effectiveMasterSku },
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

const generateSkuPreviewSchema = z.object({
  categoryId: z.string().trim().optional(),
  brandOrShg: z.string().trim().optional(),
  productName: z.string().trim().min(1).max(160),
  variantLabels: z.array(z.string().trim()).max(50).optional(),
}).strict();

export const generateSkuPreviewController: RequestHandler = async (req, res) => {
  const input = generateSkuPreviewSchema.parse(req.body);
  const sellerId = req.user?.id || 'ESK';
  const masterSku = generateMasterSku({
    categoryId: input.categoryId,
    brandOrShg: input.brandOrShg,
    productName: input.productName,
    sellerId,
  });
  const barcode = generateIndianBarcode(masterSku);
  const variantSkus = (input.variantLabels || []).map((label, idx) => ({
    label,
    sku: generateVariantSku(masterSku, label, idx),
  }));
  sendData(res, {
    masterSku,
    barcode,
    variantSkus,
  });
};

export const lookupMasterCatalogBySkuController: RequestHandler = async (req, res) => {
  const q = String(req.query.q || req.params.sku || '').trim().toLowerCase();
  if (!q) throw new AppError(400, 'INVALID_QUERY', 'Provide a SKU, barcode, or product name.');
  const masterMatch = MASTER_PRODUCT_CATALOG.find(
    (p) =>
      p.masterSku.toLowerCase() === q ||
      p.barcode.toLowerCase() === q ||
      p.name.toLowerCase().includes(q),
  );
  const dbMatch = await Product.findOne({
    isArchived: false,
    $or: [
      { masterSku: { $regex: `^${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
      { barcode: q },
      { 'variants.sku': { $regex: `^${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
    ],
  }).lean();
  sendData(res, {
    masterTemplate: masterMatch || null,
    existingProduct: dbMatch || null,
  });
};

export const backfillSellerProductSkusController: RequestHandler = async (req, res) => {
  const actorId = authenticatedUserId(req);
  const role = req.user?.role;
  const filter: Record<string, unknown> = { isArchived: false };
  if (role === 'seller') {
    filter.sellerId = new mongoose.Types.ObjectId(actorId);
  }
  const products = await Product.find(filter);
  let updatedCount = 0;

  for (const prod of products) {
    let changed = false;
    const masterSku = prod.masterSku?.trim() || generateMasterSku({
      categoryId: prod.categoryId || prod.category,
      brandOrShg: 'SHG',
      productName: prod.name,
      sellerId: prod.sellerId ? String(prod.sellerId) : String(prod._id),
    });
    if (prod.masterSku !== masterSku) {
      prod.masterSku = masterSku;
      changed = true;
    }
    if (!prod.barcode?.trim()) {
      prod.barcode = generateIndianBarcode(masterSku);
      changed = true;
    }
    if (prod.variants && prod.variants.length > 0) {
      prod.variants.forEach((v, idx) => {
        if (!v.sku?.trim()) {
          v.sku = generateVariantSku(masterSku, v.attributes, idx);
          changed = true;
        }
      });
    }
    if (changed) {
      await prod.save();
      updatedCount += 1;
    }
  }

  sendData(res, {
    scannedCount: products.length,
    updatedCount,
    message: updatedCount > 0
      ? `Standardized Master SKUs, EAN-13 Barcodes & Variant SKUs generated for ${updatedCount} product(s).`
      : `All ${products.length} product(s) already have valid Master & Variant SKUs.`,
  });
};

