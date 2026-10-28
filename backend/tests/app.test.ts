import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { requestOtpSchema, savedAddressSchema } from '../src/modules/auth/auth.schemas.js';
import { bestSellerQuerySchema, productCreateSchema } from '../src/modules/catalog/product.schemas.js';
import {
  createOrderSchema,
  bulkDeliveryPartnerSchema,
  deliveryPartnerSchema,
  fulfilmentUpdateSchema,
  orderListQuerySchema,
  orderPaginationQuerySchema,
} from '../src/modules/orders/order.schemas.js';
import {
  canAssignDeliveryPartner,
  nextFulfilmentStatus,
  statusAfterDeliveryPartnerAssignment,
} from '../src/modules/orders/order.transitions.js';
import { pushTokenSchema } from '../src/modules/notifications/notification.schemas.js';
import { settingsUpdateSchema } from '../src/modules/settings/settings.schemas.js';

let app: Express;

const protectedRoutes = [
  ['GET', '/api/v1/auth/me'],
  ['PATCH', '/api/v1/auth/me'],
  ['PUT', '/api/v1/auth/me/addresses'],
  ['POST', '/api/v1/orders'],
  ['GET', '/api/v1/orders'],
  ['GET', '/api/v1/orders/64a1b2c3d4e5f6a7b8c9d0e1'],
  ['POST', '/api/v1/orders/64a1b2c3d4e5f6a7b8c9d0e1/cancellation-requests'],
  ['POST', '/api/v1/notifications/push-token'],
  ['DELETE', '/api/v1/notifications/push-token'],
  ['GET', '/api/v1/admin/products'],
  ['POST', '/api/v1/admin/products/images'],
  ['POST', '/api/v1/admin/products'],
  ['PATCH', '/api/v1/admin/products/64a1b2c3d4e5f6a7b8c9d0e1'],
  ['DELETE', '/api/v1/admin/products/64a1b2c3d4e5f6a7b8c9d0e1'],
  ['GET', '/api/v1/admin/orders'],
  ['GET', '/api/v1/admin/orders/64a1b2c3d4e5f6a7b8c9d0e1'],
  ['PATCH', '/api/v1/admin/orders/64a1b2c3d4e5f6a7b8c9d0e1/fulfilment'],
  ['PUT', '/api/v1/admin/orders/64a1b2c3d4e5f6a7b8c9d0e1/delivery-partner'],
  ['POST', '/api/v1/admin/orders/64a1b2c3d4e5f6a7b8c9d0e1/notes'],
  ['POST', '/api/v1/admin/orders/64a1b2c3d4e5f6a7b8c9d0e1/payment-review'],
  ['POST', '/api/v1/admin/orders/64a1b2c3d4e5f6a7b8c9d0e1/cancellation-review'],
  ['POST', '/api/v1/admin/orders/delivery-partner-assignments'],
  ['GET', '/api/v1/admin/notifications'],
  ['POST', '/api/v1/admin/notifications/64a1b2c3d4e5f6a7b8c9d0e1/retry'],
  ['GET', '/api/v1/admin/settings'],
  ['PUT', '/api/v1/admin/settings'],
  ['POST', '/api/v1/admin/inventory/64a1b2c3d4e5f6a7b8c9d0e1/adjustments'],
  ['GET', '/api/v1/admin/dashboard'],
  ['GET', '/api/v1/super-admin/overview'],
  ['GET', '/api/v1/super-admin/orders'],
  ['GET', '/api/v1/city-admin/dashboard'],
  ['GET', '/api/v1/city-admin/orders'],
  ['GET', '/api/v1/seller/dashboard'],
  ['GET', '/api/v1/seller/products'],
  ['GET', '/api/v1/seller/orders'],
  ['GET', '/api/v1/admin/customers'],
  ['GET', '/api/v1/admin/customers/64a1b2c3d4e5f6a7b8c9d0e1'],
  ['GET', '/api/v1/admin/customers/64a1b2c3d4e5f6a7b8c9d0e1/orders'],
  ['GET', '/api/v1/admin/delivery-partners'],
  ['GET', '/api/v1/admin/delivery-partners/64a1b2c3d4e5f6a7b8c9d0e1'],
  ['PATCH', '/api/v1/admin/delivery-partners/64a1b2c3d4e5f6a7b8c9d0e1/status'],
  ['PATCH', '/api/v1/admin/users/64a1b2c3d4e5f6a7b8c9d0e1/role'],
  ['PATCH', '/api/v1/admin/users/64a1b2c3d4e5f6a7b8c9d0e1/status'],
  ['GET', '/api/v1/delivery-partners/orders'],
  ['GET', '/api/v1/delivery-partners/orders/history'],
  ['PATCH', '/api/v1/delivery-partners/orders/64a1b2c3d4e5f6a7b8c9d0e1/status'],
] as const;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/esakhi-test?replicaSet=rs0';
  process.env.CLIENT_ORIGINS = 'http://localhost:5173/,http://localhost:5174/';
  process.env.JWT_ACCESS_SECRET = 'a'.repeat(128);
  process.env.JWT_REFRESH_SECRET = 'b'.repeat(128);
  process.env.OTP_PROVIDER = 'development';
  process.env.DEV_OTP_CODE = '246810';
  ({ app } = await import('../src/app.js'));
}, 60_000);

describe('backend API foundation', () => {
  it('provides API information at the server root', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.data.apiBase).toBe('/api/v1');
    expect(response.body.data.health).toBe('/health');
  });

  it('provides API endpoint information at the versioned API root', async () => {
    const response = await request(app).get('/api/v1');

    expect(response.status).toBe(200);
    expect(response.body.data.endpoints).toContain('/products');
  });

  it('normalizes Indian phone numbers and rejects malformed numbers', () => {
    expect(requestOtpSchema.parse({ phone: '98765 43210' }).phone).toBe('+919876543210');
    expect(() => requestOtpSchema.parse({ phone: '+911234567890' })).toThrow();
  });

  it('accepts a complete saved address and rejects incomplete address fields', () => {
    const address = {
      label: 'Primary',
      name: 'Customer',
      phone: '+919876543210',
      addressLine1: '12 Main Street',
      addressLine2: 'Near the library',
      locality: 'Civil Ward',
      city: 'Damoh',
      state: 'Madhya Pradesh',
      postalCode: '470661',
    };
    expect(savedAddressSchema.safeParse(address).success).toBe(true);
    expect(savedAddressSchema.safeParse({ ...address, city: '' }).success).toBe(false);
    expect(savedAddressSchema.safeParse({ ...address, phone: '9876543210' }).success).toBe(false);
  });

  it('requires an address for delivery checkout', () => {
    const parsed = createOrderSchema.safeParse({
      idempotencyKey: 'request-key-0001',
      customerName: 'Customer',
      customerPhone: '+919876543210',
      fulfilmentMethod: 'delivery',
      items: [{ productId: '64a1b2c3d4e5f6a7b8c9d0e1', quantity: 1 }],
      paymentMethod: 'upi',
    });

    expect(parsed.success).toBe(false);
  });

  it('parses customer-order pagination without using a refined schema pick', () => {
    expect(orderPaginationQuerySchema.parse({ page: '2', limit: '5' })).toEqual({ page: 2, limit: 5 });
    expect(orderPaginationQuerySchema.safeParse({ page: '2', limit: '5', q: 'ignored' }).success).toBe(false);
  });

  it('parses admin filters for pending and reviewed cancellation requests', () => {
    expect(orderListQuerySchema.parse({ cancellationRequest: 'pending' }).cancellationRequest).toBe('pending');
    expect(orderListQuerySchema.parse({ cancellationRequest: 'reviewed' }).cancellationRequest).toBe('reviewed');
    expect(orderListQuerySchema.safeParse({ cancellationRequest: 'unknown' }).success).toBe(false);
  });

  it('requires a configured delivery fee before enabling delivery', () => {
    const settings = {
      businessName: 'eSakhi',
      city: 'Damoh',
      state: 'Madhya Pradesh',
      serviceableLocalities: [{ name: 'Damoh', postalCodes: ['470661'], deliveryFeePaise: 0 }],
      pickupEnabled: true,
      deliveryEnabled: true,
      staffEnabled: false,
      upiEnabled: false,
      cashEnabled: false,
      policies: {},
      lowStockThreshold: 5,
      stockReservationHours: null,
    };

    expect(settingsUpdateSchema.safeParse({
      ...settings,
      serviceableLocalities: [{ name: 'Damoh', postalCodes: ['470661'] }],
    }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse(settings).success).toBe(true);
  });

  it('does not allow base stock to be set when a product has variants', () => {
    const parsed = productCreateSchema.safeParse({
      name: 'Handmade bangles',
      slug: 'handmade-bangles',
      description: 'Test product',
      category: 'Bangles',
      pricePaise: 15000,
      stock: 1,
      variants: [{ attributes: { size: 'Small' }, stock: 2 }],
    });
    expect(parsed.success).toBe(false);
  });

  it('limits public bestseller requests to a bounded number of products', () => {
    expect(bestSellerQuerySchema.parse({})).toEqual({ limit: 5 });
    expect(bestSellerQuerySchema.parse({ limit: '12' })).toEqual({ limit: 12 });
    expect(bestSellerQuerySchema.safeParse({ limit: '13' }).success).toBe(false);
    expect(bestSellerQuerySchema.safeParse({ page: '2' }).success).toBe(false);
  });

  it('enforces separate delivery and pickup status transitions', () => {
    expect(nextFulfilmentStatus('placed', 'delivery')).toBe('accepted');
    expect(nextFulfilmentStatus('preparing', 'delivery')).toBe('out_for_delivery');
    expect(nextFulfilmentStatus('out_for_delivery', 'delivery')).toBe('delivered');
    expect(nextFulfilmentStatus('preparing', 'pickup')).toBe('ready_for_pickup');
    expect(nextFulfilmentStatus('ready_for_pickup', 'pickup')).toBe('completed');
    expect(nextFulfilmentStatus('cancelled', 'delivery')).toBeNull();
  });

  it('allows delivery partner assignment only once until a delivery attempt fails', () => {
    expect(canAssignDeliveryPartner('preparing', false)).toBe(true);
    expect(canAssignDeliveryPartner('preparing', true)).toBe(false);
    expect(canAssignDeliveryPartner('out_for_delivery', true)).toBe(false);
    expect(canAssignDeliveryPartner('delivery_failed', true)).toBe(true);
    expect(canAssignDeliveryPartner('delivered', false)).toBe(false);
  });

  it('resets a failed delivery to preparing when a new partner is assigned', () => {
    expect(statusAfterDeliveryPartnerAssignment('delivery_failed')).toBe('preparing');
    expect(statusAfterDeliveryPartnerAssignment('preparing')).toBe('preparing');
    expect(statusAfterDeliveryPartnerAssignment('out_for_delivery')).toBe('out_for_delivery');
  });

  it('validates delivery partner details and the delivered status', () => {
    expect(deliveryPartnerSchema.safeParse({ name: 'Delivery Partner', phone: '9876543210' }).success).toBe(true);
    expect(deliveryPartnerSchema.safeParse({ partnerId: '64a1b2c3d4e5f6a7b8c9d0e1' }).success).toBe(true);
    expect(deliveryPartnerSchema.safeParse({ name: 'Partner', phone: '12345' }).success).toBe(false);
    expect(fulfilmentUpdateSchema.safeParse({ status: 'delivered' }).success).toBe(true);
  });

  it('validates unique, bounded bulk delivery assignments', () => {
    const request = {
      partnerId: '64a1b2c3d4e5f6a7b8c9d0e1',
      orderIds: ['64a1b2c3d4e5f6a7b8c9d0e2', '64a1b2c3d4e5f6a7b8c9d0e3'],
    };
    expect(bulkDeliveryPartnerSchema.safeParse(request).success).toBe(true);
    expect(bulkDeliveryPartnerSchema.safeParse({ ...request, orderIds: [request.orderIds[0], request.orderIds[0]] }).success).toBe(false);
  });

  it('validates push tokens', () => {
    expect(pushTokenSchema.safeParse({ token: 'a'.repeat(40) }).success).toBe(true);
    expect(pushTokenSchema.safeParse({ token: 'short' }).success).toBe(false);
  });

  it('accepts server-uploaded image paths in product data', () => {
    const parsed = productCreateSchema.safeParse({
      name: 'Handmade bangles',
      slug: 'handmade-bangles',
      description: 'Test product',
      category: 'Bangles',
      pricePaise: 15000,
      imageUrls: ['/uploads/product-images/123e4567-e89b-42d3-a456-426614174000.jpg'],
    });

    expect(parsed.success).toBe(true);
  });

  it('provides a lightweight liveness response without database access', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { status: 'ok' } });
  });

  it('allows configured browser origins and credentialed preflight requests', async () => {
    const response = await request(app)
      .options('/api/v1/auth/otp/request')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
  });

  it('rejects browser origins that are not configured', async () => {
    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://unconfigured.example');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CORS_ORIGIN_DENIED');
  });

  it('serves the fixed product categories', async () => {
    const response = await request(app).get('/api/v1/categories');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(['Bangles', 'Jewellery', 'Dupattas', 'Others']);
  });

  it('serves the product category alias', async () => {
    const response = await request(app).get('/api/v1/products/categories');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(['Bangles', 'Jewellery', 'Dupattas', 'Others']);
  });

  it.each(protectedRoutes)('requires authentication for %s %s', async (method, path) => {
    const response = method === 'GET'
      ? await request(app).get(path)
      : method === 'POST'
        ? await request(app).post(path).send({})
        : method === 'PATCH'
          ? await request(app).patch(path).send({})
          : method === 'PUT'
            ? await request(app).put(path).send({})
            : await request(app).delete(path);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns a standard validation response for invalid pagination', async () => {
    const response = await request(app).get('/api/v1/products?page=0');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.fields.page).toBeDefined();
  });

  it('protects admin APIs server-side', async () => {
    const response = await request(app).get('/api/v1/admin/settings');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('requires Super Admin authentication for the global overview', async () => {
    const response = await request(app).get('/api/v1/super-admin/overview');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('requires City Admin authentication for city-scoped endpoints', async () => {
    const dashboard = await request(app).get('/api/v1/city-admin/dashboard');
    const orders = await request(app).get('/api/v1/city-admin/orders');

    expect(dashboard.status).toBe(401);
    expect(dashboard.body.error.code).toBe('UNAUTHORIZED');
    expect(orders.status).toBe(401);
    expect(orders.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns not-ready until the database is connected', async () => {
    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('NOT_READY');
  });
});
