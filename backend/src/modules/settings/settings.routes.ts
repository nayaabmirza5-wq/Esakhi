import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getAdminSettings, getPublicServiceArea, updateAdminSettings } from './settings.controller.js';

export const settingsRoutes = Router();
export const adminSettingsRoutes = Router();

settingsRoutes.get('/', getPublicServiceArea);
adminSettingsRoutes.use(requireAuth, requireRole('admin', 'super_admin'));
adminSettingsRoutes.get('/', getAdminSettings);
adminSettingsRoutes.put('/', updateAdminSettings);
