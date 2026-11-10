import { Schema, model } from 'mongoose';

const serviceLocalitySchema = new Schema(
  {
    name: { type: String, trim: true, required: true, maxlength: 100 },
    postalCodes: { type: [String], default: [] },
    deliveryFeePaise: { type: Number, min: 0 },
    coveredLocalities: { type: [String], default: [] },
  },
  { _id: false },
);

const settingsSchema = new Schema(
  {
    key: { type: String, default: 'global', unique: true, required: true },
    businessName: { type: String, trim: true, maxlength: 120, default: 'eSakhi' },
    phone: { type: String, trim: true, maxlength: 30 },
    whatsapp: { type: String, trim: true, maxlength: 30 },
    address: { type: String, trim: true, maxlength: 500 },
    city: { type: String, trim: true, maxlength: 100, default: 'Damoh' },
    state: { type: String, trim: true, maxlength: 100, default: 'Madhya Pradesh' },
    serviceableLocalities: { type: [serviceLocalitySchema], default: [] },
    pickupEnabled: { type: Boolean, default: false, required: true },
    deliveryEnabled: { type: Boolean, default: false, required: true },
    staffEnabled: { type: Boolean, default: false, required: true },
    upiEnabled: { type: Boolean, default: false, required: true },
    upiId: { type: String, trim: true, maxlength: 100 },
    upiQrUrl: { type: String, trim: true, maxlength: 500 },
    upiInstructions: { type: String, trim: true, maxlength: 1000 },
    cashEnabled: { type: Boolean, default: false, required: true },
    cashInstructions: { type: String, trim: true, maxlength: 1000 },
    pickupInstructions: { type: String, trim: true, maxlength: 1000 },
    stockReservationHours: { type: Number, min: 1, max: 720, default: null },
    policies: {
      type: Map,
      of: { type: String, maxlength: 5000 },
      default: {},
    },
    lowStockThreshold: { type: Number, min: 0, default: 5, required: true },
  },
  { timestamps: true },
);

export const Settings = model('Settings', settingsSchema);
