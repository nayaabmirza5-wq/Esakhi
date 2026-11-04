import { Schema, model } from 'mongoose';

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

export const Product = model('Product', productSchema);
