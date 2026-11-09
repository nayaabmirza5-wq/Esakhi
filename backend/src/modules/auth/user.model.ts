import { Schema, model } from 'mongoose';
import type { InferSchemaType } from 'mongoose';
import { userRoles } from './roles.js';

const savedAddressSchema = new Schema(
  {
    label: { type: String, trim: true, maxlength: 40, default: 'Home' },
    name: { type: String, trim: true, required: true, maxlength: 120 },
    phoneE164: { type: String, required: true, match: /^\+91[6-9]\d{9}$/ },
    addressLine1: { type: String, trim: true, required: true, maxlength: 200 },
    addressLine2: { type: String, trim: true, maxlength: 200 },
    locality: { type: String, trim: true, required: true, maxlength: 100 },
    city: { type: String, trim: true, required: true, maxlength: 100 },
    state: { type: String, trim: true, required: true, maxlength: 100 },
    postalCode: { type: String, required: true, match: /^\d{6}$/ },
    houseNumber: { type: String, trim: true, maxlength: 100 },
    street: { type: String, trim: true, maxlength: 150 },
    area: { type: String, trim: true, maxlength: 100 },
    landmark: { type: String, trim: true, maxlength: 150 },
    villageOrCity: { type: String, trim: true, maxlength: 100 },
    district: { type: String, trim: true, maxlength: 100 },
    formattedAddress: { type: String, trim: true, maxlength: 700 },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    locationAccuracyMeters: { type: Number, min: 0, max: 100_000 },
    deliveryInstructions: { type: String, trim: true, maxlength: 500 },
    isDefault: { type: Boolean, default: false, required: true },
  },
  { _id: true },
);

const bankAccountSchema = new Schema(
  {
    accountHolderName: { type: String, trim: true, maxlength: 120 },
    accountNumber: { type: String, trim: true, maxlength: 32 },
    ifscCode: { type: String, trim: true, uppercase: true, maxlength: 20 },
    bankName: { type: String, trim: true, maxlength: 120 },
    upiId: { type: String, trim: true, maxlength: 120 },
    linkedAt: { type: Date },
    verified: { type: Boolean, default: false },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    phoneE164: { type: String, required: true, unique: true },
    phone: { type: String },
    name: { type: String, trim: true, maxlength: 120 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    role: { type: String, enum: [...userRoles], default: 'customer', required: true },
    assignedCity: { type: String, trim: true, maxlength: 100 },
    serviceableLocalities: { type: [String], default: [] },
    status: { type: String, enum: ['active', 'disabled'], default: 'active', required: true },
    isOnline: { type: Boolean, default: true },
    availabilityStatus: {
      type: String,
      enum: ['available', 'busy', 'offline'],
      default: 'available',
    },
    currentLocation: {
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 },
      updatedAt: { type: Date },
    },
    refreshTokenHash: { type: String, select: false },
    savedAddresses: { type: [savedAddressSchema], default: [] },
    bankAccount: { type: bankAccountSchema },
    remittancePin: { type: String, trim: true, maxlength: 6 },
    remittancePinExpiresAt: { type: Date },
    previousRemittancePin: { type: String, trim: true, maxlength: 6 },
    previousPinExpiresAt: { type: Date },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

userSchema.pre('validate', function () {
  const self = this as unknown as {
    phoneE164?: string;
    phone?: string;
    name?: string;
    role?: string;
    remittancePin?: string;
    remittancePinExpiresAt?: Date;
  };
  if (self.role === 'delivery_partner' && !self.remittancePin) {
    self.remittancePin = String(Math.floor(1000 + Math.random() * 9000));
    self.remittancePinExpiresAt = new Date(Date.now() + 60_000);
  }
  if (!self.phoneE164 && self.phone) {
    self.phoneE164 = self.phone.startsWith('+') ? self.phone : `+91${self.phone.replace(/\D/g, '').slice(-10)}`;
  }
  if (!self.phone && self.phoneE164) {
    self.phone = self.phoneE164;
  }
  if (!self.name) {
    const raw = self.phone || self.phoneE164 || '';
    self.name = `User ${raw.slice(-4) || '0000'}`;
  }
});

export const User = model('User', userSchema);
export type SavedAddressRecord = InferSchemaType<typeof savedAddressSchema>;
export type BankAccountRecord = InferSchemaType<typeof bankAccountSchema>;
