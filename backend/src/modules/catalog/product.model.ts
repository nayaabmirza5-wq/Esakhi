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
    category: { type: String, enum: ['Bangles', 'Jewellery', 'Dupattas', 'Others'], required: true, index: true },
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
productSchema.index({ category: 1, isActive: 1, isArchived: 1, createdAt: -1 });

export const Product = model('Product', productSchema);
