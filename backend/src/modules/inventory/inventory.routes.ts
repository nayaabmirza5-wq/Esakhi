import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { adjustInventory } from './inventory.controller.js';

export const inventoryRoutes = Router();
inventoryRoutes.use(requireAuth, requireRole('admin', 'super_admin'));
inventoryRoutes.post('/:productId/adjustments', adjustInventory);
