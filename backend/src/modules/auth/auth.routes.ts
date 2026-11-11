import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  logoutController,
  createSavedAddressController,
  deleteSavedAddressController,
  listSavedAddressesController,
  meController,
  reverseAddressController,
  refreshController,
  requestOtpController,
  replaceSavedAddressesController,
  searchAddressController,
  setDefaultSavedAddressController,
  updateProfileController,
  updateSavedAddressController,
  verifyOtpController,
} from './auth.controller.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { env } from '../../config/env.js';

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'production' ? 40 : 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  validate: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many verification attempts. Try again later.' },
  },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  validate: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many session refresh requests. Try again later.' },
  },
});

const addressLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.NODE_ENV === 'production' ? 40 : 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  validate: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many address lookups. Try again shortly.' },
  },
});

export const authRoutes = Router();

authRoutes.post('/otp/request', otpLimiter, requestOtpController);
authRoutes.post('/otp/verify', otpLimiter, verifyOtpController);
authRoutes.post('/send-otp', otpLimiter, requestOtpController);
authRoutes.post('/verify-otp', otpLimiter, verifyOtpController);
authRoutes.post('/refresh', refreshLimiter, refreshController);
authRoutes.post('/logout', logoutController);
authRoutes.get('/me', requireAuth, meController);
authRoutes.patch('/me', requireAuth, updateProfileController);
authRoutes.get('/me/addresses', requireAuth, listSavedAddressesController);
authRoutes.post('/me/addresses', requireAuth, createSavedAddressController);
authRoutes.put('/me/addresses', requireAuth, replaceSavedAddressesController);
authRoutes.patch('/me/addresses/:addressId', requireAuth, updateSavedAddressController);
authRoutes.delete('/me/addresses/:addressId', requireAuth, deleteSavedAddressController);
authRoutes.put('/me/addresses/:addressId/default', requireAuth, setDefaultSavedAddressController);
authRoutes.get('/me/address-search', requireAuth, addressLookupLimiter, searchAddressController);
authRoutes.get('/me/address-reverse', requireAuth, addressLookupLimiter, reverseAddressController);
