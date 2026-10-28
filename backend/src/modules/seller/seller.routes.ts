import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getSellerDashboard, listSellerOrders, listSellerProducts } from './seller.controller.js';

export const sellerRoutes = Router();

sellerRoutes.use(requireAuth, requireRole('seller'));
sellerRoutes.get('/dashboard', getSellerDashboard);
sellerRoutes.get('/products', listSellerProducts);
sellerRoutes.get('/orders', listSellerOrders);
