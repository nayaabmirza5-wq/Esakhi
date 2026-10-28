import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { adminDashboard, getCustomer, getDeliveryPartner, listCustomerOrders, listCustomers, listDeliveryPartners, updateCustomerRole, updateCustomerStatus, updateDeliveryPartnerStatus } from './admin.controller.js';

export const adminRoutes = Router();
adminRoutes.use(requireAuth, requireRole('admin', 'super_admin'));
adminRoutes.get('/dashboard', adminDashboard);
adminRoutes.get('/customers', listCustomers);
adminRoutes.get('/customers/:customerId', getCustomer);
adminRoutes.get('/customers/:customerId/orders', listCustomerOrders);
adminRoutes.get('/delivery-partners', listDeliveryPartners);
adminRoutes.get('/delivery-partners/:userId', getDeliveryPartner);
adminRoutes.patch('/delivery-partners/:userId/status', updateDeliveryPartnerStatus);
adminRoutes.patch('/users/:userId/role', updateCustomerRole);
adminRoutes.patch('/users/:userId/status', updateCustomerStatus);
