import express from 'express';
// @ts-ignore
import * as helmetModule from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { connectDatabase } from './config/db.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { productRoutes, adminProductRoutes } from './modules/catalog/product.routes.js';
import { categoriesController } from './modules/catalog/product.controller.js';
import { customerOrderRoutes, adminOrderRoutes, deliveryPartnerRoutes } from './modules/orders/order.routes.js';
import { settingsRoutes, adminSettingsRoutes } from './modules/settings/settings.routes.js';
import { inventoryRoutes } from './modules/inventory/inventory.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { logger } from './utils/logger.js';
import { AppError } from './utils/AppError.js';
import { productImagesDirectory } from './modules/catalog/productImageUpload.js';
import { adminNotificationRoutes, pushNotificationRoutes } from './modules/notifications/notification.routes.js';
import { superAdminRoutes } from './modules/superAdmin/superAdmin.routes.js';
import { cityAdminRoutes } from './modules/cityAdmin/cityAdmin.routes.js';
import { trackCityAdminOrderPartner } from './modules/cityAdmin/cityAdminOrder.controller.js';
import { requireAuth } from './middleware/requireAuth.js';
import { requireRole } from './middleware/requireRole.js';
import { sellerRoutes } from './modules/seller/seller.routes.js';
import { sellerApplicationRoutes } from './modules/seller/sellerApplication.routes.js';
import { deliveryPartnerApplicationRoutes } from './modules/cityAdmin/deliveryPartnerApplication.routes.js';
import { lookupShgCode } from './modules/seller/seller.controller.js';
import { paymentRoutes } from './modules/payments/payment.routes.js';

// helmet's typings differ between installs under NodeNext (default export may resolve to the module namespace).
type HelmetFactory = () => express.RequestHandler;
const helmet = ((helmetModule as unknown as { default?: HelmetFactory }).default ?? helmetModule) as unknown as HelmetFactory;

export const app = express();
app.set('trust proxy', env.TRUST_PROXY_HOPS || 1);

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

// @ts-ignore
app.use(helmet());

const rawOrigins = process.env.CLIENT_ORIGINS || '';
const allowedList = rawOrigins.split(',').map((o) => o.trim()).filter(Boolean);

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow mobile apps, curl, or requests with no origin
    if (!origin) return callback(null, true);

    // Allow explicit origins from CLIENT_ORIGINS or localhost or env.corsOrigins
    if (allowedList.includes(origin) || origin.includes('localhost') || env.corsOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow any Vercel deployment preview / production domain
    if (/^https:\/\/.*\.vercel\.app$/.test(origin)) {
      return callback(null, true);
    }

    return callback(new AppError(403, 'CORS_ORIGIN_DENIED', 'Origin is not allowed. (CORS_ORIGIN_DENIED)'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));
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

const STATELESS_PATHS = new Set([
  '/',
  '/health',
  '/api/health',
  '/api/v1/health',
  '/ready',
  '/api/ready',
  '/api/v1/ready',
  '/api',
  '/api/',
  '/api/v1',
  '/api/v1/',
  '/api/categories',
  '/api/v1/categories',
  '/api/products/categories',
  '/api/v1/products/categories',
  '/api/auth/send-otp',
  '/api/v1/auth/send-otp',
  '/api/auth/otp/request',
  '/api/v1/auth/otp/request',
]);

app.use(async (req, _res, next) => {
  if (env.NODE_ENV === 'test' || process.env.NODE_ENV === 'test') {
    return next();
  }
  if (STATELESS_PATHS.has(req.path)) {
    if (req.path.includes('/send-otp') || req.path.includes('/otp/request')) {
      void connectDatabase().catch(() => {});
    }
    return next();
  }
  try {
    await connectDatabase();
    next();
  } catch (error) {
    next(error);
  }
});

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
  limit: process.env.NODE_ENV === 'development' ? 2500 : 1500,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  validate: false,
  skip: (req) =>
    req.path === '/health' ||
    req.path === '/ready' ||
    req.originalUrl.includes('/track/partner') ||
    req.path.includes('/track/partner') ||
    req.originalUrl.includes('/city-admin/'),
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Try again later.' },
  },
});

const api = express.Router();
api.use(apiLimiter);
api.get('/health', (_req, res) => {
  res.status(200).json({ success: true, data: { status: 'ok' } });
});
api.get('/ready', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({
    success: ready,
    ...(ready
      ? { data: { status: 'ready' } }
      : { error: { code: 'NOT_READY', message: 'The database is not ready.' } }),
  });
});
api.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      message: 'eSakhi API v1',
      endpoints: ['/auth', '/products', '/categories', '/service-area', '/orders', '/delivery-partners', '/seller-applications', '/admin', '/super-admin'],
      health: '/health',
    },
  });
});
api.use('/auth', authRoutes);
api.use('/notifications', pushNotificationRoutes);
api.use('/products', productRoutes);
api.get('/categories', categoriesController);
api.use('/service-area', settingsRoutes);
api.use('/orders', customerOrderRoutes);
api.use('/payments', paymentRoutes);
api.use('/delivery-partners', deliveryPartnerRoutes);
api.use('/admin/products', adminProductRoutes);
api.use('/admin/orders', adminOrderRoutes);
api.use('/admin/notifications', adminNotificationRoutes);
api.use('/admin/settings', adminSettingsRoutes);
api.use('/admin/inventory', inventoryRoutes);
api.use('/admin', adminRoutes);
api.use('/super-admin', superAdminRoutes);
api.use('/city-admin', cityAdminRoutes);
api.get('/track/partner/:orderId', requireAuth, requireRole('city_admin', 'admin', 'super_admin'), trackCityAdminOrderPartner);
api.use('/seller', sellerRoutes);
api.use('/seller-applications', sellerApplicationRoutes);
api.get('/shg/lookup/:code', lookupShgCode);
api.use('/delivery-partner-applications', deliveryPartnerApplicationRoutes);
app.use('/api/v1', api);
app.use('/api', api);
app.get('/api/track/partner/:orderId', apiLimiter, requireAuth, requireRole('city_admin', 'admin', 'super_admin'), trackCityAdminOrderPartner);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } });
});

app.use(errorHandler);

export default app;
