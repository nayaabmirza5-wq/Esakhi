import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  addInternalNote,
  assignDeliveryPartner,
  createOrderController,
  getAdminOrder,
  getMyOrder,
  listAdminOrders,
  listAssignedPartnerOrders,
  listMyOrders,
  requestOrderCancellation,
  reviewCancellation,
  reviewPayment,
  updateFulfilmentStatus,
  updatePartnerOrderStatus,
} from './order.controller.js';

export const customerOrderRoutes = Router();
export const adminOrderRoutes = Router();
export const deliveryPartnerRoutes = Router();

customerOrderRoutes.use(requireAuth);
customerOrderRoutes.post('/', createOrderController);
customerOrderRoutes.get('/', listMyOrders);
customerOrderRoutes.get('/:id', getMyOrder);
customerOrderRoutes.post('/:id/cancellation-requests', requestOrderCancellation);

deliveryPartnerRoutes.use(requireAuth, requireRole('delivery_partner'));
deliveryPartnerRoutes.get('/orders', listAssignedPartnerOrders);
deliveryPartnerRoutes.patch('/orders/:id/status', updatePartnerOrderStatus);

adminOrderRoutes.use(requireAuth, requireRole('admin', 'staff'));
adminOrderRoutes.get('/', listAdminOrders);
adminOrderRoutes.get('/:id', getAdminOrder);
adminOrderRoutes.patch('/:id/fulfilment', updateFulfilmentStatus);
adminOrderRoutes.put('/:id/delivery-partner', assignDeliveryPartner);
adminOrderRoutes.post('/:id/notes', requireRole('admin', 'staff'), addInternalNote);
adminOrderRoutes.post('/:id/payment-review', requireRole('admin'), reviewPayment);
adminOrderRoutes.post('/:id/cancellation-review', requireRole('admin'), reviewCancellation);
