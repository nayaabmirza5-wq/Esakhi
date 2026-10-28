import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  createSuperAdminCityAdmin,
  getSuperAdminCity,
  getSuperAdminCityAdmin,
  getSuperAdminCityAdmins,
  getSuperAdminSeller,
  getSuperAdminSellers,
  listSuperAdminAuditLogs,
  listSuperAdminCities,
  listSuperAdminOrders,
  getSuperAdminOverview,
  updateSuperAdminCityAdmin,
} from './superAdmin.controller.js';

export const superAdminRoutes = Router();

superAdminRoutes.use(requireAuth, requireRole('super_admin'));
superAdminRoutes.get('/overview', getSuperAdminOverview);
superAdminRoutes.get('/orders', listSuperAdminOrders);
superAdminRoutes.get('/cities', listSuperAdminCities);
superAdminRoutes.get('/cities/:city', getSuperAdminCity);
superAdminRoutes.get('/city-admins', getSuperAdminCityAdmins);
superAdminRoutes.get('/city-admins/:userId', getSuperAdminCityAdmin);
superAdminRoutes.post('/city-admins', createSuperAdminCityAdmin);
superAdminRoutes.patch('/city-admins/:userId', updateSuperAdminCityAdmin);
superAdminRoutes.get('/sellers', getSuperAdminSellers);
superAdminRoutes.get('/sellers/:userId', getSuperAdminSeller);
superAdminRoutes.get('/audit-logs', listSuperAdminAuditLogs);
