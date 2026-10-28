import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { sendData } from '../../utils/apiResponse.js';
import { AppError } from '../../utils/AppError.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { Settings } from './settings.model.js';
import { settingsUpdateSchema } from './settings.schemas.js';

export const getPublicServiceArea: RequestHandler = async (_req, res) => {
  const settings = await Settings.findOne({ key: 'global' }).lean();
  if (!settings) {
    sendData(res, {
      configured: false,
      city: 'Damoh',
      state: 'Madhya Pradesh',
      deliveryEnabled: false,
      serviceableLocalities: [],
    });
    return;
  }
  sendData(res, {
    configured: settings.pickupEnabled || settings.deliveryEnabled,
    businessName: settings.businessName,
    phone: settings.phone,
    whatsapp: settings.whatsapp,
    address: settings.address,
    city: settings.city,
    state: settings.state,
    deliveryEnabled: settings.deliveryEnabled,
    pickupEnabled: settings.pickupEnabled,
    serviceableLocalities: settings.deliveryEnabled ? settings.serviceableLocalities : [],
    pickupInstructions: settings.pickupEnabled ? settings.pickupInstructions : undefined,
    paymentMethods: {
      upi: settings.upiEnabled ? { upiId: settings.upiId, qrImageUrl: settings.upiQrUrl, instructions: settings.upiInstructions } : undefined,
      cash: settings.cashEnabled ? { instructions: settings.cashInstructions } : undefined,
    },
    policies: settings.policies,
  });
};

export const getAdminSettings: RequestHandler = async (_req, res) => {
  const settings = await Settings.findOne({ key: 'global' }).lean();
  sendData(res, settings ?? null);
};

export const updateAdminSettings: RequestHandler = async (req, res) => {
  const input = settingsUpdateSchema.parse(req.body);
  const actorId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let settings;
  try {
    settings = await session.withTransaction(async () => {
      const updated = await Settings.findOneAndUpdate(
        { key: 'global' },
        { $set: input, $setOnInsert: { key: 'global' } },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, session },
      );
      if (!updated) throw new AppError(500, 'INTERNAL_ERROR', 'Unable to save business settings.');
      await AuditLog.create([{
        actorId,
        action: 'settings.updated',
        resourceType: 'settings',
        resourceId: String(updated.id),
        metadata: { changedFields: Object.keys(input) },
      }], { session });
      return updated;
    });
  } finally {
    await session.endSession();
  }
  if (!settings) throw new AppError(500, 'INTERNAL_ERROR', 'Unable to save business settings.');
  sendData(res, settings);
};
