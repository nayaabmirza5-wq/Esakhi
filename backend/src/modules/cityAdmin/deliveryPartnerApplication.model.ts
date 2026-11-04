import { Schema, model } from 'mongoose';

const deliveryPartnerApplicationSchema = new Schema(
  {
    name: { type: String, trim: true, required: true, maxlength: 120 },
    phoneE164: { type: String, required: true, maxlength: 16 },
    city: { type: String, trim: true, required: true, maxlength: 100, index: true },
    requestedLocalities: {
      type: [String],
      required: true,
      validate: [(localities: string[]) => localities.length > 0 && localities.length <= 20, 'Select between 1 and 20 localities.'],
    },
    applicantNote: { type: String, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'needs_info', 'action_required'],
      default: 'pending',
      required: true,
    },
    reviewNote: { type: String, trim: true, maxlength: 1000 },
    flaggedFields: { type: [String], default: [] },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,

    // Rich Biodata & "No-DL" Dynamic Vehicle Attributes
    selfieUrl: { type: String, trim: true },
    emergencyContactName: { type: String, trim: true, maxlength: 120 },
    emergencyContactRel: { type: String, trim: true, maxlength: 50 },
    emergencyContactPhone: { type: String, trim: true, maxlength: 16 },
    residentialAddress: { type: String, trim: true, maxlength: 300 },
    pincode: { type: String, trim: true, maxlength: 6 },
    vehicleType: { type: String, enum: ['BICYCLE', 'MOTORCYCLE'], default: 'BICYCLE' },
    maxDeliveryRadiusKm: { type: Number, default: 3.0 },
    dlNumber: { type: String, trim: true, maxlength: 30 },
    dlExpiryDate: Date,
    vehicleRcNumber: { type: String, trim: true, maxlength: 30 },

    // Document URLs
    govIdUrl: { type: String, trim: true },
    dlFrontUrl: { type: String, trim: true },
    dlBackUrl: { type: String, trim: true },
    passbookDocUrl: { type: String, trim: true },

    // Double-entry Banking & Payout Parameters
    bankDetails: {
      accountHolderName: { type: String, trim: true, maxlength: 120 },
      accountNumberMasked: { type: String, trim: true, maxlength: 34 },
      accountNumberHash: { type: String, trim: true, maxlength: 64 },
      ifscCode: { type: String, trim: true, maxlength: 11 },
      bankName: { type: String, trim: true, maxlength: 150 },
      branchName: { type: String, trim: true, maxlength: 150 },
      upiVpa: { type: String, trim: true, maxlength: 100 },
      isVerified: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

deliveryPartnerApplicationSchema.index({ city: 1, status: 1, createdAt: -1 });
deliveryPartnerApplicationSchema.index({ phoneE164: 1, city: 1, status: 1 });

export const DeliveryPartnerApplication = model('DeliveryPartnerApplication', deliveryPartnerApplicationSchema);
