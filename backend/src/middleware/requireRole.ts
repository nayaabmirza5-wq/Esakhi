import type { RequestHandler } from 'express';
import { AppError } from '../utils/AppError.js';
import { Settings } from '../modules/settings/settings.model.js';

export function requireRole(...roles: Array<'customer' | 'staff' | 'admin' | 'delivery_partner'>): RequestHandler {
  return async (req, _res, next) => {
    if (!req.user || !roles.some((role) => role === req.user?.role)) {
      next(new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
      return;
    }
    if (req.user.role === 'staff') {
      const settings = await Settings.findOne({ key: 'global' }).select('staffEnabled').lean();
      if (!settings?.staffEnabled) {
        next(new AppError(403, 'FORBIDDEN', 'Staff access is not enabled.'));
        return;
      }
    }
    next();
  };
}
