import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Product } from '../catalog/product.model.js';
import { Seller } from '../../models/Seller.js';
import { User } from '../auth/user.model.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { sendData } from '../../utils/apiResponse.js';
import { AppError } from '../../utils/AppError.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import {
  calculateProductFinancials,
  validateProductScope,
  validateShelfLife,
  type SellerTaxProfile,
} from '../catalog/pricingTaxEngine.js';
import { MASTER_PRODUCT_CATALOG } from '../catalog/masterProductCatalog.js';

const merchantProductCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180).optional(),
  description: z.string().trim().min(1).max(5000),
  category: z.string().trim().min(1).optional(),
  categoryId: z.string().trim().min(1),
  subcategoryId: z.string().trim().min(1).optional().default('general'),
  productType: z.string().trim().min(1).max(160).optional().default('Packaged Goods'),
  masterSku: z.string().trim().max(100).optional(),
  barcode: z.string().trim().max(30).optional(),
  hsnCode: z.string().trim().max(20).optional(),
  productGstRate: z.number().refine((val) => [0, 5, 12, 18, 28].includes(val), 'GST rate must be 0, 5, 12, 18, or 28%').default(18),
  printedUnitMrp: z.number().positive('Printed Unit MRP must be greater than 0'),
  sellerBasePrice: z.number().positive('Seller Base Price must be greater than 0'),
  minOrderQuantity: z.number().int().min(1).optional(),
  bestBeforeDate: z.string().trim().min(4, 'Shelf life best before date is required'),
  stock: z.number().int().min(0).default(10),
  lowStockThreshold: z.number().int().min(0).default(5),
  imageUrls: z.array(z.string()).default([]),
  sellerTaxProfile: z.enum(['GST_REGISTERED', 'NON_GST_ENROLMENT']).optional(),
  isInterState: z.boolean().default(false),
  sellerAnnualSalesExceeds5Lakh: z.boolean().default(false),
});

async function resolveUniqueProductSlug(baseSlug: string, session?: mongoose.ClientSession): Promise<string> {
  const normalizedBase = baseSlug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product';
  let candidate = normalizedBase.slice(0, 180);
  let counter = 2;
  while (true) {
    const query = Product.findOne({ slug: candidate }).select('_id');
    if (session) query.session(session);
    const existing = await query.lean();
    if (!existing) return candidate;
    const suffix = `-${counter}`;
    candidate = `${normalizedBase.slice(0, Math.max(1, 180 - suffix.length)).replace(/-+$/, '')}${suffix}`;
    counter += 1;
  }
}

/**
 * POST /api/merchant/products
 * End-to-end Merchant Add Product endpoint with:
 * - Strict Product Scope validation (packaged non-perishable only; no fresh food, cooked meals, loose produce, or medicines)
 * - Legal Metrology MRP Ceiling enforcement
 * - ₹30 Minimum Line-Item Value & Automatic Bulk MOQ calculation
 * - Mandatory Shelf-Life validation (at least 60 days ahead)
 * - Indian Tax Ledger Snapshot generation & persistence
 */
export const createMerchantProduct: RequestHandler = async (req, res) => {
  const input = merchantProductCreateSchema.parse(req.body);
  const sellerId = authenticatedUserId(req);

  // 1. Strict Product Scope Enforcement
  const scopeValidation = validateProductScope({
    category: input.categoryId || input.category || '',
    name: input.name,
    description: input.description,
  });
  if (!scopeValidation.isValid) {
    throw new AppError(400, 'INVALID_PRODUCT_SCOPE', scopeValidation.error || 'Strict Product Scope Violation.');
  }

  // 2. Mandatory Shelf-Life Validation (>= 60 days ahead)
  const shelfLifeValidation = validateShelfLife(input.bestBeforeDate);
  if (!shelfLifeValidation.isValid) {
    throw new AppError(400, 'INVALID_SHELF_LIFE', shelfLifeValidation.error || 'Product shelf life must be at least 60 days.');
  }

  // 3. Resolve Seller Tax Profile if not explicitly provided
  let taxProfile: SellerTaxProfile = input.sellerTaxProfile || 'GST_REGISTERED';
  let sellerRecord = null;
  if (!input.sellerTaxProfile && sellerId) {
    sellerRecord = await Seller.findOne({ userId: sellerId }).lean();
    if (sellerRecord?.taxDetails?.hasGst) {
      taxProfile = 'GST_REGISTERED';
    } else if (sellerRecord?.taxDetails?.hasEnrolmentId) {
      taxProfile = 'NON_GST_ENROLMENT';
    }
  }

  // 4. Calculate Financials, Legal Metrology MRP ceiling, Auto MOQ & Tax Ledger Snapshot
  const financials = calculateProductFinancials({
    sellerBasePrice: input.sellerBasePrice,
    printedUnitMrp: input.printedUnitMrp,
    category: input.categoryId,
    productGstRate: input.productGstRate,
    sellerTaxProfile: taxProfile,
    minOrderQuantity: input.minOrderQuantity,
    isInterState: input.isInterState,
    sellerAnnualSalesExceeds5Lakh: input.sellerAnnualSalesExceeds5Lakh,
  });

  if (!financials.isValid) {
    throw new AppError(400, 'LEGAL_METROLOGY_VIOLATION', financials.errorMessage || 'Invalid pricing structure.');
  }

  // 5. Check / Auto-fill Master SKU Catalogue metadata if matching barcode or master SKU
  let resolvedMasterSku = input.masterSku;
  let resolvedBarcode = input.barcode;
  let resolvedHsnCode = input.hsnCode;

  if (input.barcode || input.masterSku) {
    const matchedMaster = MASTER_PRODUCT_CATALOG.find(
      (m) => (input.barcode && m.barcode === input.barcode) || (input.masterSku && m.masterSku === input.masterSku)
    );
    if (matchedMaster) {
      resolvedMasterSku = resolvedMasterSku || matchedMaster.masterSku;
      resolvedBarcode = resolvedBarcode || matchedMaster.barcode;
      resolvedHsnCode = resolvedHsnCode || matchedMaster.hsnCode;
    }
  }

  if (!resolvedMasterSku) {
    resolvedMasterSku = `SKU-${input.categoryId.toUpperCase().slice(0, 4)}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  }

  // 6. Persist to Database with complete Tax Ledger Snapshot
  const baseSlug = input.slug || input.name;
  const session = await mongoose.startSession();
  let createdProduct = null;

  try {
    await session.withTransaction(async () => {
      const uniqueSlug = await resolveUniqueProductSlug(baseSlug, session);

      // Convert to paise for storage
      const packPricePaise = Math.round(financials.packSellingPrice * 100);
      const basePricePaise = Math.round(financials.sellerPackBaseValue * 100);
      const platformFeePaise = Math.round(financials.embeddedPlatformMargin * financials.minOrderQuantity * 100);
      const cityAdminFeePaise = Math.round(financials.commissionAmount * 0.2 * 100);

      const product = new Product({
        name: input.name,
        slug: uniqueSlug,
        description: input.description,
        category: input.category || input.categoryId,
        categoryId: input.categoryId,
        categoryName: input.category || input.categoryId,
        subcategoryId: input.subcategoryId,
        subcategoryName: input.subcategoryId,
        productType: input.productType,
        isFoodProduct: false,
        classificationStatus: 'classified',
        approvalStatus: 'approved',
        foodComplianceStatus: 'not_required',
        sellerId: sellerId ? new mongoose.Types.ObjectId(sellerId) : null,
        pricePaise: packPricePaise,
        basePricePaise,
        platformFeePaise,
        cityAdminFeePaise,
        masterSku: resolvedMasterSku,
        barcode: resolvedBarcode,
        hsnCode: resolvedHsnCode,
        printedUnitMrpPaise: Math.round(financials.printedUnitMrp * 100),
        sellerBasePricePaise: Math.round(financials.sellerBasePrice * 100),
        customerUnitPricePaise: Math.round(financials.customerUnitPrice * 100),
        minOrderQuantity: financials.minOrderQuantity,
        productGstRate: input.productGstRate,
        bestBeforeDate: input.bestBeforeDate,
        imageUrls: input.imageUrls,
        stock: input.stock,
        lowStockThreshold: input.lowStockThreshold,
        isActive: true,
        isArchived: false,
        taxLedgerSnapshot: {
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
          sellerTaxProfile: financials.sellerTaxProfile,
          calculatedAt: new Date(),
        },
      });

      await product.save({ session });
      createdProduct = product;

      if (sellerId) {
        await AuditLog.create(
          [
            {
              actorId: sellerId,
              action: 'merchant.product_created',
              resourceType: 'product',
              resourceId: String(product._id),
              metadata: {
                masterSku: resolvedMasterSku,
                barcode: resolvedBarcode,
                minOrderQuantity: financials.minOrderQuantity,
                customerUnitPrice: financials.customerUnitPrice,
                netBankPayout: financials.netBankPayout,
              },
            },
          ],
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }

  if (!createdProduct) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create merchant product.');
  }

  sendData(res, { product: createdProduct, financials }, 201);
};

/**
 * GET /api/merchant/master-catalogue
 * Search or list pre-approved Master Catalogue SKUs with standard HSN, GST, and MRP
 */
export const getMasterCatalogue: RequestHandler = (_req, res) => {
  const query = String(_req.query.q || '').trim().toLowerCase();
  let results = MASTER_PRODUCT_CATALOG;

  if (query) {
    results = MASTER_PRODUCT_CATALOG.filter(
      (item) =>
        item.barcode.includes(query) ||
        item.masterSku.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        item.hindiName.includes(query) ||
        item.brand.toLowerCase().includes(query)
    );
  }

  sendData(res, { items: results, count: results.length });
};

/**
 * GET /api/merchant/products/similar/:masterSku
 * Find alternative nearby stores carrying the same Master SKU when a shop is closed
 */
export const getSimilarProductsByMasterSku: RequestHandler = async (req, res) => {
  const { masterSku } = req.params;
  if (!masterSku) throw new AppError(400, 'PARAM_REQUIRED', 'Master SKU is required');

  const products = await Product.find({
    masterSku,
    isActive: true,
    isArchived: false,
    stock: { $gt: 0 },
  })
    .select('name slug pricePaise minOrderQuantity customerUnitPricePaise sellerId imageUrls stock')
    .lean();

  const sellerIds = products.map((p) => p.sellerId).filter(Boolean);
  const sellers = await User.find({ _id: { $in: sellerIds } }).select('name phoneE164').lean();
  const sellerById = new Map(sellers.map((s) => [String(s._id), s]));

  const enriched = products.map((p) => {
    const seller = p.sellerId ? sellerById.get(String(p.sellerId)) : undefined;
    return {
      ...p,
      sellerName: seller?.name || 'Local Store',
    };
  });

  sendData(res, { masterSku, alternatives: enriched });
};
