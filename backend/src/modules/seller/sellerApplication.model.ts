import { Schema, model } from 'mongoose';

const sellerApplicationSchema = new Schema(
  {
    shgName: { type: String, trim: true, required: true, maxlength: 160 },
    representative: { type: String, trim: true, required: true, maxlength: 120 },
    phoneE164: { type: String, required: true, maxlength: 13 },
    city: { type: String, trim: true, required: true, maxlength: 100 },
    registeredAddress: { type: String, trim: true, required: true, maxlength: 500 },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    storeDescription: { type: String, trim: true, maxlength: 1000, default: '' },
    primaryCategoryId: { type: String, trim: true },
    primaryCategoryName: { type: String, trim: true },
    primarySubcategoryId: { type: String, trim: true },
    primarySubcategoryName: { type: String, trim: true },
    primaryProductType: { type: String, trim: true, required: true, maxlength: 160 },
    primaryClassificationStatus: { type: String, enum: ['classified', 'needs_review'], default: 'needs_review', required: true },
    primaryClassificationNote: { type: String, trim: true, maxlength: 500 },
    fssaiRegistrationNumber: { type: String, trim: true, maxlength: 14 },
    fssaiStatus: { type: String, enum: ['not_required', 'pending', 'verified', 'needs_info'], default: 'not_required', required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'needs_info'], default: 'pending', required: true },
    reviewNote: { type: String, trim: true, maxlength: 1000 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  },
  { timestamps: true },
);

sellerApplicationSchema.index({ city: 1, status: 1, createdAt: -1 });

export const SellerApplication = model('SellerApplication', sellerApplicationSchema);
