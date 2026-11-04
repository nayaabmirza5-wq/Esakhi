import { Router } from 'express';
import { submitDeliveryPartnerApplication } from './deliveryPartnerApplication.controller.js';

export const deliveryPartnerApplicationRoutes = Router();

deliveryPartnerApplicationRoutes.post('/', submitDeliveryPartnerApplication);