import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { createSellerProduct } from '../catalog/product.controller.js';
import { receiveProductImage, saveProductImage } from '../catalog/productImageUpload.js';
import {
  adjustSellerInventory,
  getSellerDashboard,
  getSellerSettlements,
  listSellerInventoryHistory,
  listSellerOrders,
  listSellerProducts,
  updateSellerOrderStatus,
  updateSellerProfile,
  uploadSellerOrderInspectionImages,
} from './seller.controller.js';

export const sellerRoutes = Router();

sellerRoutes.use(requireAuth, requireRole('seller'));
sellerRoutes.get('/dashboard', getSellerDashboard);
sellerRoutes.get('/settlements', getSellerSettlements);
sellerRoutes.patch('/profile', updateSellerProfile);
sellerRoutes.get('/products', listSellerProducts);
sellerRoutes.post('/products/images', receiveProductImage, saveProductImage);
sellerRoutes.post('/products', createSellerProduct);
sellerRoutes.post('/products/:productId/inventory-adjustments', adjustSellerInventory);
sellerRoutes.get('/products/:productId/inventory-adjustments', listSellerInventoryHistory);
sellerRoutes.get('/orders', listSellerOrders);
sellerRoutes.post('/orders/:orderId/inspection-images', uploadSellerOrderInspectionImages);
sellerRoutes.patch('/orders/:orderId/status', updateSellerOrderStatus);
