import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  createMerchantProduct,
  getMasterCatalogue,
  getSimilarProductsByMasterSku,
} from './merchant.controller.js';

export const merchantRoutes = Router();

// Public routes for catalog lookup & alternative store matching
merchantRoutes.get('/master-catalogue', getMasterCatalogue);
merchantRoutes.get('/products/similar/:masterSku', getSimilarProductsByMasterSku);

// Merchant authenticated product creation
merchantRoutes.post('/products', requireAuth, requireRole('seller', 'admin', 'super_admin', 'city_admin'), createMerchantProduct);
