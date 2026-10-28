import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  listFailedNotifications,
  registerPushToken,
  removePushToken,
  retryFailedNotification,
} from './notification.controller.js';

export const pushNotificationRoutes = Router();
export const adminNotificationRoutes = Router();

const pushTokenLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many push token changes. Try again later.' },
  },
});

pushNotificationRoutes.use(requireAuth, requireRole('customer'));
pushNotificationRoutes.post('/push-token', pushTokenLimiter, registerPushToken);
pushNotificationRoutes.delete('/push-token', pushTokenLimiter, removePushToken);

adminNotificationRoutes.use(requireAuth, requireRole('admin', 'super_admin'));
adminNotificationRoutes.get('/', listFailedNotifications);
adminNotificationRoutes.post('/:id/retry', retryFailedNotification);
