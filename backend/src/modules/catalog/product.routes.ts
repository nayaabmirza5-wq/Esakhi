import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  archiveProduct,
  listBestSellingProducts,
  categoriesController,
  createProduct,
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

adminProductRoutes.use(requireAuth, requireRole('admin', 'staff'));
adminProductRoutes.get('/', listAllProductsForAdmin);
adminProductRoutes.post('/images', requireRole('admin'), receiveProductImage, saveProductImage);
adminProductRoutes.post('/', requireRole('admin'), createProduct);
adminProductRoutes.patch('/:id', requireRole('admin'), updateProduct);
adminProductRoutes.delete('/:id', requireRole('admin'), archiveProduct);
