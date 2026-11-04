import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createCityAdminServiceZoneChangeRequest, flagCityAdminProduct, getCityAdminDashboard, getCityAdminServiceZones, listCityAdminOrders, listCityAdminProducts, listCityAdminSellers, reviewCityAdminProduct } from './cityAdmin.controller.js';
import { listCityAdminDeliveryPartnerApplications, listCityAdminDeliveryPartners, reviewCityAdminDeliveryPartnerApplication } from './deliveryPartnerApplication.controller.js';
import {
  arbitrateCityAdminReturnDispute,
  assignCityAdminDeliveryPartner,
  assignCityAdminReverseDeliveryPartner,
  escalateCityAdminOrderRefund,
  getCityAdminOrder,
  trackCityAdminOrderPartner,
} from './cityAdminOrder.controller.js';

export const cityAdminRoutes = Router();

cityAdminRoutes.use(requireAuth, requireRole('city_admin'));
cityAdminRoutes.get('/dashboard', getCityAdminDashboard);
cityAdminRoutes.get('/service-zones', getCityAdminServiceZones);
cityAdminRoutes.post('/service-zone-change-requests', createCityAdminServiceZoneChangeRequest);
cityAdminRoutes.get('/sellers', listCityAdminSellers);
cityAdminRoutes.get('/products', listCityAdminProducts);
cityAdminRoutes.post('/products/:productId/flags', flagCityAdminProduct);
cityAdminRoutes.patch('/products/:productId/review', reviewCityAdminProduct);
cityAdminRoutes.get('/delivery-partners', listCityAdminDeliveryPartners);
cityAdminRoutes.get('/delivery-partner-applications', listCityAdminDeliveryPartnerApplications);
cityAdminRoutes.patch('/delivery-partner-applications/:applicationId/review', reviewCityAdminDeliveryPartnerApplication);
cityAdminRoutes.get('/track/partner/:orderId', trackCityAdminOrderPartner);
cityAdminRoutes.get('/orders/:orderId', getCityAdminOrder);
cityAdminRoutes.put('/orders/:orderId/delivery-partner', assignCityAdminDeliveryPartner);
cityAdminRoutes.post('/orders/:orderId/return-arbitration', arbitrateCityAdminReturnDispute);
cityAdminRoutes.put('/orders/:orderId/reverse-partner', assignCityAdminReverseDeliveryPartner);
cityAdminRoutes.post('/orders/:orderId/escalate-refund', escalateCityAdminOrderRefund);
cityAdminRoutes.get('/orders', listCityAdminOrders);
