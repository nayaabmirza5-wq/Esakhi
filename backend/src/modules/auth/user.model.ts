import { Schema, model } from 'mongoose';
import { userRoles } from './roles.js';

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
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    role: { type: String, enum: [...userRoles], default: 'customer', required: true },
    assignedCity: { type: String, trim: true, maxlength: 100 },
    status: { type: String, enum: ['active', 'disabled'], default: 'active', required: true },
    refreshTokenHash: { type: String, select: false },
    savedAddresses: { type: [savedAddressSchema], default: [] },
  },
  { timestamps: true },
);

export const User = model('User', userSchema);
