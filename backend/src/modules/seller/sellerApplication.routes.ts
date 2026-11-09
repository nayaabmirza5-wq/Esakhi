import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { listSellerApplications, reviewSellerApplication, submitSellerApplication } from './sellerApplication.controller.js';
import { completeSellerOnboarding } from './seller.controller.js';
import { optionalAuth } from '../../middleware/requireAuth.js';

export const sellerApplicationRoutes = Router();

sellerApplicationRoutes.post('/', submitSellerApplication);
sellerApplicationRoutes.post('/onboard', optionalAuth, completeSellerOnboarding);
sellerApplicationRoutes.get('/', requireAuth, requireRole('city_admin'), listSellerApplications);
sellerApplicationRoutes.patch('/:applicationId/review', requireAuth, requireRole('city_admin'), reviewSellerApplication);