import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  archiveProduct,
  listBestSellingProducts,
  categoriesController,
  createProduct,
  getAdminProduct,
  getProductBySlug,
  listAllProductsForAdmin,
  listProducts,
  updateProduct,
} from './product.controller.js';
import { receiveProductImage, saveProductImage } from './productImageUpload.js';

export const productRoutes = Router();
export const adminProductRoutes = Router();

productRoutes.get('/', listProducts);
productRoutes.get('/categories', categoriesController);
productRoutes.get('/bestsellers', listBestSellingProducts);
productRoutes.get('/:slug', getProductBySlug);

adminProductRoutes.use(requireAuth, requireRole('admin', 'staff', 'super_admin'));
adminProductRoutes.get('/', listAllProductsForAdmin);
adminProductRoutes.get('/:id', getAdminProduct);
adminProductRoutes.post('/images', requireRole('admin', 'super_admin'), receiveProductImage, saveProductImage);
adminProductRoutes.post('/', requireRole('admin', 'super_admin'), createProduct);
adminProductRoutes.patch('/:id', requireRole('admin', 'super_admin'), updateProduct);
adminProductRoutes.delete('/:id', requireRole('admin', 'super_admin'), archiveProduct);
