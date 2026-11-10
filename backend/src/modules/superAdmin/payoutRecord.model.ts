import mongoose, { Schema, model } from 'mongoose';

export interface PayoutRecordDocument {
  payoutReference: string;
  beneficiaryType: 'city_admin' | 'seller' | 'delivery_partner';
  beneficiaryId: mongoose.Types.ObjectId;
  beneficiaryName: string;
  beneficiaryPhone: string;
  city: string;
  grossAmountPaise: number;
  commissionPaise: number;
  penaltyDeductionsPaise: number;
  netPaidPaise: number;
  bankAccountSnapshot?: {
    accountHolderName?: string | undefined;
    accountNumberMasked?: string | undefined;
    ifscCode?: string | undefined;
    bankName?: string | undefined;
    upiId?: string | undefined;
  } | undefined;
  paymentMethod: 'upi_intent' | 'bank_transfer' | 'razorpay_manual';
  utrReference: string;
  status: 'disbursed' | 'settled';
  disbursedBy: mongoose.Types.ObjectId;
  disbursedByName: string;
  disbursedAt: Date;
  notes?: string | undefined;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}

const payoutRecordSchema = new Schema<PayoutRecordDocument>(
  {
    payoutReference: { type: String, required: true, unique: true, index: true },
    beneficiaryType: {
      type: String,
      required: true,
      enum: ['city_admin', 'seller', 'delivery_partner'],
      index: true,
    },
    beneficiaryId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    beneficiaryName: { type: String, required: true, trim: true },
    beneficiaryPhone: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true, index: true },
    grossAmountPaise: { type: Number, required: true, min: 0 },
    commissionPaise: { type: Number, default: 0, min: 0 },
    penaltyDeductionsPaise: { type: Number, default: 0, min: 0 },
    netPaidPaise: { type: Number, required: true, min: 0 },
    bankAccountSnapshot: {
      accountHolderName: { type: String, trim: true },
      accountNumberMasked: { type: String, trim: true },
      ifscCode: { type: String, trim: true, uppercase: true },
      bankName: { type: String, trim: true },
      upiId: { type: String, trim: true },
    },
    paymentMethod: {
      type: String,
      required: true,
      enum: ['upi_intent', 'bank_transfer', 'razorpay_manual'],
      default: 'upi_intent',
    },
    utrReference: { type: String, required: true, trim: true, unique: true, index: true },
    status: {
      type: String,
      required: true,
      enum: ['disbursed', 'settled'],
      default: 'settled',
    },
    disbursedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    disbursedByName: { type: String, required: true, trim: true },
    disbursedAt: { type: Date, required: true, default: Date.now },
    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

export const PayoutRecord = model<PayoutRecordDocument>('PayoutRecord', payoutRecordSchema);
