import express from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import {
  getRazorpayConfig,
  createRazorpayOrderController,
  verifyRazorpayPaymentController,
  razorpayWebhookController,
} from './payment.controller.js';

export const paymentRoutes = express.Router();

paymentRoutes.get('/razorpay/config', getRazorpayConfig);
paymentRoutes.post('/razorpay/create-order', requireAuth, createRazorpayOrderController);
paymentRoutes.post('/razorpay/verify-payment', requireAuth, verifyRazorpayPaymentController);
paymentRoutes.post('/razorpay/webhook', express.raw({ type: 'application/json' }), razorpayWebhookController);
