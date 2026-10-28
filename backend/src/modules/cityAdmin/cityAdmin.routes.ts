import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getCityAdminDashboard, listCityAdminOrders } from './cityAdmin.controller.js';

export const cityAdminRoutes = Router();

cityAdminRoutes.use(requireAuth, requireRole('city_admin'));
cityAdminRoutes.get('/dashboard', getCityAdminDashboard);
cityAdminRoutes.get('/orders', listCityAdminOrders);
