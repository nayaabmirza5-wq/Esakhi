import type { RequestHandler } from 'express';
import { AppError } from '../utils/AppError.js';
import { Settings } from '../modules/settings/settings.model.js';
import { isRoleAllowed, type UserRole } from '../modules/auth/roles.js';

export function requireRole(...roles: UserRole[]): RequestHandler {
  return async (req, _res, next) => {
    if (!req.user || !isRoleAllowed(req.user.role, roles)) {
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
