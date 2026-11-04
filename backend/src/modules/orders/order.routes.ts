import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  addInternalNote,
  assignDeliveryPartner,
  broadcastPartnerOrderLocation,
  bulkAssignDeliveryPartner,
  cancelOrderDirect,
  createOrderController,
  getAdminOrder,
  getCustomerBankAccount,
  getMyOrder,
  getPartnerProfile,
  getPartnerSettlements,
  listAdminOrders,
  listAssignedPartnerOrders,
  listPartnerDeliveryHistory,
  listMyOrders,
  requestOrderCancellation,
  reviewCancellation,
  reviewPayment,
  submitCustomerReturnRequest,
  updateFulfilmentStatus,
  updatePartnerAvailability,
  reportPartnerDeliveryFailure,
  updatePartnerOrderStatus,
  updatePartnerReverseOrderStatus,
  upsertCustomerBankAccount,
} from './order.controller.js';

export const customerOrderRoutes = Router();
export const adminOrderRoutes = Router();
export const deliveryPartnerRoutes = Router();

customerOrderRoutes.use(requireAuth);
customerOrderRoutes.get('/bank-account', getCustomerBankAccount);
customerOrderRoutes.put('/bank-account', upsertCustomerBankAccount);
customerOrderRoutes.post('/', createOrderController);
customerOrderRoutes.get('/', listMyOrders);
customerOrderRoutes.get('/:id', getMyOrder);
customerOrderRoutes.post('/:id/cancellation-requests', requestOrderCancellation);
customerOrderRoutes.post('/:id/cancel-direct', cancelOrderDirect);
customerOrderRoutes.post('/:id/return-request', submitCustomerReturnRequest);

deliveryPartnerRoutes.use(requireAuth, requireRole('delivery_partner'));
deliveryPartnerRoutes.get('/profile', getPartnerProfile);
deliveryPartnerRoutes.patch('/availability', updatePartnerAvailability);
deliveryPartnerRoutes.get('/orders', listAssignedPartnerOrders);
deliveryPartnerRoutes.get('/orders/history', listPartnerDeliveryHistory);
deliveryPartnerRoutes.get('/settlements', getPartnerSettlements);
deliveryPartnerRoutes.patch('/orders/:id/status', updatePartnerOrderStatus);
deliveryPartnerRoutes.post('/orders/:id/delivery-failure', reportPartnerDeliveryFailure);
deliveryPartnerRoutes.patch('/orders/:id/reverse-status', updatePartnerReverseOrderStatus);
deliveryPartnerRoutes.post('/orders/:id/location', broadcastPartnerOrderLocation);

adminOrderRoutes.use(requireAuth, requireRole('admin', 'staff', 'super_admin'));
adminOrderRoutes.get('/', listAdminOrders);
adminOrderRoutes.get('/:id', getAdminOrder);
adminOrderRoutes.post('/delivery-partner-assignments', bulkAssignDeliveryPartner);
adminOrderRoutes.patch('/:id/fulfilment', updateFulfilmentStatus);
adminOrderRoutes.put('/:id/delivery-partner', assignDeliveryPartner);
adminOrderRoutes.post('/:id/notes', requireRole('admin', 'staff', 'super_admin'), addInternalNote);
adminOrderRoutes.post('/:id/payment-review', requireRole('admin', 'super_admin'), reviewPayment);
adminOrderRoutes.post('/:id/cancellation-review', requireRole('admin', 'super_admin'), reviewCancellation);
