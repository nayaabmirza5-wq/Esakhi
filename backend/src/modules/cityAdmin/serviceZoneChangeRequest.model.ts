import { Schema, model } from 'mongoose';

const serviceZoneChangeRequestSchema = new Schema(
  {
    city: { type: String, trim: true, required: true, maxlength: 100, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestText: { type: String, trim: true, required: true, maxlength: 1000 },
    status: { type: String, enum: ['pending', 'reviewed', 'rejected'], default: 'pending', required: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    responseNote: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
);

serviceZoneChangeRequestSchema.index({ city: 1, status: 1, createdAt: -1 });

export const ServiceZoneChangeRequest = model('ServiceZoneChangeRequest', serviceZoneChangeRequestSchema);