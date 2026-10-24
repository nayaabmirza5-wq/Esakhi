import { Schema, model } from 'mongoose';

const savedAddressSchema = new Schema(
  {
    label: { type: String, trim: true, maxlength: 40 },
    name: { type: String, trim: true, required: true, maxlength: 120 },
    phoneE164: { type: String, required: true },
    addressLine1: { type: String, trim: true, required: true, maxlength: 200 },
    addressLine2: { type: String, trim: true, maxlength: 200 },
    locality: { type: String, trim: true, required: true, maxlength: 100 },
    city: { type: String, trim: true, required: true, maxlength: 100 },
    state: { type: String, trim: true, required: true, maxlength: 100 },
    postalCode: { type: String, required: true },
  },
  { _id: true },
);

const userSchema = new Schema(
  {
    phoneE164: { type: String, required: true, unique: true },
    name: { type: String, trim: true, maxlength: 120 },
    role: { type: String, enum: ['customer', 'staff', 'admin', 'delivery_partner'], default: 'customer', required: true },
    status: { type: String, enum: ['active', 'disabled'], default: 'active', required: true },
    refreshTokenHash: { type: String, select: false },
    savedAddresses: { type: [savedAddressSchema], default: [] },
  },
  { timestamps: true },
);

export const User = model('User', userSchema);
