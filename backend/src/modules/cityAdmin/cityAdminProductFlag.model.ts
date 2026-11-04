import { Schema, model } from 'mongoose';

const cityAdminProductFlagSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    city: { type: String, trim: true, required: true, maxlength: 100, index: true },
    reportedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, trim: true, required: true, maxlength: 1000 },
    status: { type: String, enum: ['open', 'resolved'], default: 'open', required: true },
  },
  { timestamps: true },
);

cityAdminProductFlagSchema.index({ city: 1, status: 1, createdAt: -1 });

export const CityAdminProductFlag = model('CityAdminProductFlag', cityAdminProductFlagSchema);