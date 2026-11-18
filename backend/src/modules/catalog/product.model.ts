import { Schema, model } from 'mongoose';
import type { Document, Types } from 'mongoose';

export interface IVariant {
  _id?: Types.ObjectId;
  sku?: string | null;
  attributes?: Map<string, string> | Record<string, string>;
  stock: number;
}

export interface IProduct extends Document {
  name: string;
  slug: string;
  description: string;
  category: string;
  categoryId?: string;
  categoryName?: string;
  subcategoryId?: string;
  subcategoryName?: string;
  productType?: string;
  isFoodProduct: boolean;
  classificationStatus: 'classified' | 'needs_review';
  classificationNote?: string | null;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  foodComplianceStatus: 'not_required' | 'pending' | 'verified';
  sellerId?: Types.ObjectId | null;
  pricePaise: number;
  basePricePaise?: number;
  platformFeePaise?: number;
  cityAdminFeePaise?: number;
  masterSku?: string;
  barcode?: string;
  hsnCode?: string;
  printedUnitMrpPaise?: number;
  sellerBasePricePaise?: number;
  customerUnitPricePaise?: number;
  minOrderQuantity?: number;
  productGstRate?: number;
  bestBeforeDate?: string;
  taxLedgerSnapshot?: {
    taxableValuePaise?: number;
    productGstPaise?: number;
    cgstPaise?: number;
    sgstPaise?: number;
    igstPaise?: number;
    commissionRatePercent?: number;
    commissionPaise?: number;
    commissionGstPaise?: number;
    tcsGstPaise?: number;
    tdsPaise?: number;
    netBankPayoutPaise?: number;
    sellerTaxProfile?: string;
    calculatedAt?: Date;
  };
  imageUrls: string[];
  variants: IVariant[];
  stock: number;
  lowStockThreshold: number;
  isActive: boolean;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const variantSchema = new Schema(
  {
    sku: { type: String, trim: true, maxlength: 80 },
    attributes: {
      type: Map,
      of: { type: String, trim: true, maxlength: 80 },
      default: {},
    },
    stock: { type: Number, min: 0, required: true, default: 0 },
  },
  { _id: true },
);

const productSchema = new Schema(
  {
    name: { type: String, trim: true, required: true, maxlength: 160 },
    slug: { type: String, trim: true, lowercase: true, required: true, unique: true },
    description: { type: String, trim: true, required: true, maxlength: 5000 },
    category: { type: String, trim: true, required: true, index: true },
    categoryId: { type: String, trim: true, index: true },
    categoryName: { type: String, trim: true },
    subcategoryId: { type: String, trim: true, index: true },
    subcategoryName: { type: String, trim: true },
    productType: { type: String, trim: true, maxlength: 160 },
    isFoodProduct: { type: Boolean, default: false, required: true, index: true },
    classificationStatus: { type: String, enum: ['classified', 'needs_review'], default: 'needs_review', required: true, index: true },
    classificationNote: { type: String, trim: true, maxlength: 500 },
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', required: true, index: true },
    foodComplianceStatus: { type: String, enum: ['not_required', 'pending', 'verified'], default: 'not_required', required: true, index: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', index: true, default: null },
    pricePaise: { type: Number, min: 1, required: true },
    basePricePaise: { type: Number, min: 0, default: 0 },
    platformFeePaise: { type: Number, min: 0, default: 0 },
    cityAdminFeePaise: { type: Number, min: 0, default: 0 },
    masterSku: { type: String, trim: true, index: true },
    barcode: { type: String, trim: true, index: true },
    hsnCode: { type: String, trim: true },
    printedUnitMrpPaise: { type: Number, min: 0 },
    sellerBasePricePaise: { type: Number, min: 0 },
    customerUnitPricePaise: { type: Number, min: 0 },
    minOrderQuantity: { type: Number, min: 1 },
    productGstRate: { type: Number, enum: [0, 5, 12, 18, 28] },
    bestBeforeDate: { type: String, trim: true },
    taxLedgerSnapshot: {
      taxableValuePaise: { type: Number, default: 0 },
      productGstPaise: { type: Number, default: 0 },
      cgstPaise: { type: Number, default: 0 },
      sgstPaise: { type: Number, default: 0 },
      igstPaise: { type: Number, default: 0 },
      commissionRatePercent: { type: Number, default: 0 },
      commissionPaise: { type: Number, default: 0 },
      commissionGstPaise: { type: Number, default: 0 },
      tcsGstPaise: { type: Number, default: 0 },
      tdsPaise: { type: Number, default: 0 },
      netBankPayoutPaise: { type: Number, default: 0 },
      sellerTaxProfile: { type: String, enum: ['GST_REGISTERED', 'NON_GST_ENROLMENT'], default: 'GST_REGISTERED' },
      calculatedAt: { type: Date, default: Date.now },
    },
    imageUrls: { type: [String], default: [] },
    variants: { type: [variantSchema], default: [] },
    stock: { type: Number, min: 0, default: 0, required: true },
    lowStockThreshold: { type: Number, min: 0, default: 5, required: true },
    isActive: { type: Boolean, default: false, required: true, index: true },
    isArchived: { type: Boolean, default: false, required: true, index: true },
  },
  { timestamps: true },
);

productSchema.index({ name: 'text', description: 'text' });
productSchema.index({ categoryId: 1, subcategoryId: 1, isActive: 1, isArchived: 1, approvalStatus: 1, createdAt: -1 });
productSchema.index({ masterSku: 1, isActive: 1, isArchived: 1 });

export const Product = model('Product', productSchema);
