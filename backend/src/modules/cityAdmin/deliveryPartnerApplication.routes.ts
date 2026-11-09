import { Router } from 'express';
import { optionalAuth } from '../../middleware/requireAuth.js';
import {
  completeDeliveryPartnerOnboarding,
  submitDeliveryPartnerApplication,
} from './deliveryPartnerApplication.controller.js';

export const deliveryPartnerApplicationRoutes = Router();

deliveryPartnerApplicationRoutes.post('/', submitDeliveryPartnerApplication);
deliveryPartnerApplicationRoutes.post('/onboard', optionalAuth, completeDeliveryPartnerOnboarding);
