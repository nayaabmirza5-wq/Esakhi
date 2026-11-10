import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  addSuperAdminCityZone,
  updateSuperAdminCityZone,
  deleteSuperAdminCityZone,
  createSuperAdminCityAdmin,
  getSuperAdminCity,
  getSuperAdminCityAdmin,
  getSuperAdminCityAdmins,
  getSuperAdminSeller,
  getSuperAdminSellers,
  getSuperAdminSettlementsLedger,
  listSuperAdminAuditLogs,
  listSuperAdminCities,
  listSuperAdminOrders,
  getSuperAdminOverview,
  processSuperAdminOrderRefund,
  settleSuperAdminPenalty,
  updateSuperAdminCityAdmin,
} from './superAdmin.controller.js';
import {
  listSuperAdminSupportTickets,
  resolveSuperAdminSupportTicket,
} from '../support/supportTicket.controller.js';
import {
  getSuperAdminCityAdminSettlements,
  getSuperAdminSellerSettlements,
  getSuperAdminPartnerSettlements,
  recordSuperAdminDisbursement,
} from './settlementPayout.controller.js';

export const superAdminRoutes = Router();

superAdminRoutes.use(requireAuth, requireRole('super_admin'));
superAdminRoutes.get('/overview', getSuperAdminOverview);
superAdminRoutes.get('/settlements', getSuperAdminSettlementsLedger);
superAdminRoutes.get('/settlements/city-admins', getSuperAdminCityAdminSettlements);
superAdminRoutes.get('/settlements/sellers', getSuperAdminSellerSettlements);
superAdminRoutes.get('/settlements/delivery-partners', getSuperAdminPartnerSettlements);
superAdminRoutes.post('/payouts/record-disbursement', recordSuperAdminDisbursement);
superAdminRoutes.get('/support-tickets', listSuperAdminSupportTickets);
superAdminRoutes.patch('/support-tickets/:ticketId/resolve', resolveSuperAdminSupportTicket);
superAdminRoutes.get('/orders', listSuperAdminOrders);
superAdminRoutes.post('/orders/:orderId/process-refund', processSuperAdminOrderRefund);
superAdminRoutes.patch('/penalties/:penaltyId/settle', settleSuperAdminPenalty);
superAdminRoutes.get('/cities', listSuperAdminCities);
superAdminRoutes.get('/cities/:city', getSuperAdminCity);
superAdminRoutes.post('/cities/:city/zones', addSuperAdminCityZone);
superAdminRoutes.put('/cities/:city/zones/:index', updateSuperAdminCityZone);
superAdminRoutes.delete('/cities/:city/zones/:index', deleteSuperAdminCityZone);
superAdminRoutes.get('/city-admins', getSuperAdminCityAdmins);
superAdminRoutes.get('/city-admins/:userId', getSuperAdminCityAdmin);
superAdminRoutes.post('/city-admins', createSuperAdminCityAdmin);
superAdminRoutes.patch('/city-admins/:userId', updateSuperAdminCityAdmin);
superAdminRoutes.get('/sellers', getSuperAdminSellers);
superAdminRoutes.get('/sellers/:userId', getSuperAdminSeller);
superAdminRoutes.get('/audit-logs', listSuperAdminAuditLogs);
