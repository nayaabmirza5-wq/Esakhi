import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { productRoutes, adminProductRoutes } from './modules/catalog/product.routes.js';
import { customerOrderRoutes, adminOrderRoutes, deliveryPartnerRoutes } from './modules/orders/order.routes.js';
import { settingsRoutes, adminSettingsRoutes } from './modules/settings/settings.routes.js';
import { inventoryRoutes } from './modules/inventory/inventory.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { logger } from './utils/logger.js';
import { AppError } from './utils/AppError.js';
import { productImagesDirectory } from './modules/catalog/productImageUpload.js';
import { adminNotificationRoutes, pushNotificationRoutes } from './modules/notifications/notification.routes.js';

export const app = express();
app.set('trust proxy', env.TRUST_PROXY_HOPS);

app.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      name: 'eSakhi API',
      apiBase: '/api/v1',
      health: '/health',
      readiness: '/ready',
    },
  });
});

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new AppError(403, 'CORS_ORIGIN_DENIED', 'Origin is not allowed.'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    logger.http('HTTP request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
  next();
});
app.use('/uploads/product-images', express.static(productImagesDirectory, {
  immutable: true,
  maxAge: '1y',
  setHeaders(response) {
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  },
}));

app.get('/health', (_req, res) => {
  res.status(200).json({ success: true, data: { status: 'ok' } });
});

app.get('/ready', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({
    success: ready,
    ...(ready
      ? { data: { status: 'ready' } }
      : { error: { code: 'NOT_READY', message: 'The database is not ready.' } }),
  });
});

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path === '/ready',
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Try again later.' },
  },
});

const api = express.Router();
api.use(apiLimiter);
api.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      message: 'eSakhi API v1',
      endpoints: ['/auth', '/products', '/categories', '/service-area', '/orders', '/admin'],
      health: '/health',
    },
  });
});
api.use('/auth', authRoutes);
api.use('/notifications', pushNotificationRoutes);
api.use('/products', productRoutes);
api.use('/categories', (_req, res) => {
  res.status(200).json({ success: true, data: ['Bangles', 'Jewellery', 'Dupattas', 'Others'] });
});
api.use('/service-area', settingsRoutes);
api.use('/orders', customerOrderRoutes);
api.use('/delivery-partners', deliveryPartnerRoutes);
api.use('/admin/products', adminProductRoutes);
api.use('/admin/orders', adminOrderRoutes);
api.use('/admin/notifications', adminNotificationRoutes);
api.use('/admin/settings', adminSettingsRoutes);
api.use('/admin/inventory', inventoryRoutes);
api.use('/admin', adminRoutes);
app.use('/api/v1', api);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } });
});

app.use(errorHandler);
