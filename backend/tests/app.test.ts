import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  addressIdParamsSchema,
  addressReverseQuerySchema,
  addressSearchQuerySchema,
  requestOtpSchema,
  savedAddressSchema,
} from '../src/modules/auth/auth.schemas.js';
import { bestSellerQuerySchema, productCreateSchema } from '../src/modules/catalog/product.schemas.js';
import { categoryMaster, getCategoryHierarchy } from '../src/modules/catalog/categoryMaster.js';
import { productMaster } from '../src/modules/catalog/productMaster.js';
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
import { createSellerApplicationSchema, sellerApplicationReviewSchema } from '../src/modules/seller/sellerApplication.schemas.js';
import { sellerInventoryHistoryQuerySchema, sellerProfileUpdateSchema } from '../src/modules/seller/seller.schemas.js';
import { createDeliveryPartnerApplicationSchema, reviewDeliveryPartnerApplicationSchema } from '../src/modules/cityAdmin/deliveryPartnerApplication.schemas.js';

let app: Express;

const protectedRoutes = [
  ['GET', '/api/v1/auth/me'],
  ['PATCH', '/api/v1/auth/me'],
  ['PUT', '/api/v1/auth/me/addresses'],
  ['GET', '/api/v1/auth/me/addresses'],
  ['POST', '/api/v1/auth/me/addresses'],
  ['PATCH', '/api/v1/auth/me/addresses/64a1b2c3d4e5f6a7b8c9d0e1'],
  ['DELETE', '/api/v1/auth/me/addresses/64a1b2c3d4e5f6a7b8c9d0e1'],
  ['PUT', '/api/v1/auth/me/addresses/64a1b2c3d4e5f6a7b8c9d0e1/default'],
  ['GET', '/api/v1/auth/me/address-search?q=Damoh'],
  ['GET', '/api/v1/auth/me/address-reverse?latitude=23.8&longitude=79.4'],
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
  ['GET', '/api/v1/city-admin/service-zones'],
  ['POST', '/api/v1/city-admin/service-zone-change-requests'],
  ['GET', '/api/v1/city-admin/sellers'],
  ['GET', '/api/v1/city-admin/products'],
  ['POST', '/api/v1/city-admin/products/64a1b2c3d4e5f6a7b8c9d0e1/flags'],
  ['GET', '/api/v1/city-admin/delivery-partners'],
  ['GET', '/api/v1/city-admin/delivery-partner-applications'],
  ['PATCH', '/api/v1/city-admin/delivery-partner-applications/64a1b2c3d4e5f6a7b8c9d0e1/review'],
  ['GET', '/api/v1/city-admin/orders'],
  ['GET', '/api/v1/city-admin/orders/64a1b2c3d4e5f6a7b8c9d0e1'],
  ['PUT', '/api/v1/city-admin/orders/64a1b2c3d4e5f6a7b8c9d0e1/delivery-partner'],
  ['GET', '/api/v1/seller-applications'],
  ['PATCH', '/api/v1/seller-applications/64a1b2c3d4e5f6a7b8c9d0e1/review'],
  ['GET', '/api/v1/seller/dashboard'],
  ['PATCH', '/api/v1/seller/profile'],
  ['GET', '/api/v1/seller/products'],
  ['POST', '/api/v1/seller/products/images'],
  ['GET', '/api/v1/seller/products/64a1b2c3d4e5f6a7b8c9d0e1/inventory-adjustments'],
  ['POST', '/api/v1/seller/products/64a1b2c3d4e5f6a7b8c9d0e1/inventory-adjustments'],
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

  it('validates seller applications and normalizes Indian mobile numbers', () => {
    const application = {
      shgName: 'Sakhi Crafts',
      representative: 'Nayaab Mirza',
      phone: '9877656460',
      city: 'Damoh',
      address: 'Sagar locality, Damoh',
      categoryId: 'womens-apparel-accessories',
      subcategoryId: 'jewellery-accessories',
      productType: 'Bangles',
    };
    expect(createSellerApplicationSchema.parse(application).phone).toBe('+919877656460');
    expect(createSellerApplicationSchema.safeParse({ ...application, phone: '987765646' }).success).toBe(false);
    expect(createSellerApplicationSchema.safeParse({
      ...application,
      categoryId: 'food-items',
      subcategoryId: 'papad-snacks',
      productType: 'Papad',
    }).success).toBe(false);
    expect(createSellerApplicationSchema.safeParse({
      ...application,
      categoryId: 'food-items',
      subcategoryId: 'papad-snacks',
      productType: 'Papad',
      fssaiRegistrationNumber: '12345678901234',
    }).success).toBe(true);
    expect(sellerApplicationReviewSchema.safeParse({ decision: 'approved', note: 'Verified' }).success).toBe(true);
    expect(sellerApplicationReviewSchema.safeParse({ decision: 'rejected' }).success).toBe(false);
    expect(sellerApplicationReviewSchema.safeParse({ decision: 'rejected', note: 'Documents could not be verified.' }).success).toBe(true);
    expect(sellerApplicationReviewSchema.safeParse({ decision: 'granted_seller' }).success).toBe(false);
  });

  it('validates seller profile updates and inventory history pagination', () => {
    expect(sellerProfileUpdateSchema.parse({
      shgName: '  Sakhi Crafts  ',
      representative: '  Asha Devi  ',
      registeredAddress: '  Civil Ward, Damoh  ',
      storeDescription: '  Handmade by our group  ',
    })).toEqual({
      shgName: 'Sakhi Crafts',
      representative: 'Asha Devi',
      registeredAddress: 'Civil Ward, Damoh',
      storeDescription: 'Handmade by our group',
    });
    expect(sellerProfileUpdateSchema.safeParse({
      shgName: 'A',
      representative: 'Asha Devi',
      registeredAddress: 'Civil Ward, Damoh',
    }).success).toBe(false);
    expect(sellerInventoryHistoryQuerySchema.parse({ page: '2', limit: '25' })).toEqual({ page: 2, limit: 25 });
    expect(sellerInventoryHistoryQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('validates delivery partner applications and requires a reason to reject', () => {
    const application = {
      name: 'Rohit Patel',
      phone: '9876543210',
      city: 'Damoh',
      requestedLocalities: ['Civil Ward'],
    };
    expect(createDeliveryPartnerApplicationSchema.parse(application).phone).toBe('+919876543210');
    expect(createDeliveryPartnerApplicationSchema.safeParse({ ...application, requestedLocalities: [] }).success).toBe(false);
    expect(reviewDeliveryPartnerApplicationSchema.safeParse({ decision: 'rejected' }).success).toBe(false);
    expect(reviewDeliveryPartnerApplicationSchema.safeParse({ decision: 'rejected', note: 'Documents could not be verified.' }).success).toBe(true);
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

  it('validates address lookup inputs and accepts rural addresses with confirmed map pins', () => {
    const ruralAddress = {
      label: 'Home',
      name: 'Customer',
      phone: '+919876543210',
      addressLine1: '',
      locality: 'Damoh',
      city: 'Village',
      state: 'Madhya Pradesh',
      postalCode: '470661',
      area: 'Near the community well',
      latitude: 23.8,
      longitude: 79.4,
      locationAccuracyMeters: 35,
    };
    expect(savedAddressSchema.safeParse(ruralAddress).success).toBe(true);
    expect(savedAddressSchema.safeParse({ ...ruralAddress, latitude: 91 }).success).toBe(false);
    expect(addressSearchQuerySchema.parse({ q: 'Damoh, India' })).toEqual({ q: 'Damoh, India' });
    expect(addressSearchQuerySchema.safeParse({ q: 'ab' }).success).toBe(false);
    expect(addressReverseQuerySchema.parse({ latitude: '23.8', longitude: '79.4' })).toEqual({ latitude: 23.8, longitude: 79.4 });
    expect(addressReverseQuerySchema.safeParse({ latitude: '91', longitude: '79.4' }).success).toBe(false);
    expect(addressIdParamsSchema.safeParse({ addressId: 'not-an-id' }).success).toBe(false);
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

  it('accepts rural order addresses and recipient contact details independent of the verified account', () => {
    const parsed = createOrderSchema.safeParse({
      idempotencyKey: 'request-key-0002',
      customerName: 'Account holder',
      customerPhone: '+919876543210',
      fulfilmentMethod: 'delivery',
      address: {
        name: 'Recipient',
        phone: '+919123456789',
        addressLine1: '',
        locality: 'Damoh',
        postalCode: '470661',
        area: 'Village center',
        villageOrCity: 'Village',
        state: 'Madhya Pradesh',
        latitude: 23.8,
        longitude: 79.4,
      },
      items: [{ productId: '64a1b2c3d4e5f6a7b8c9d0e1', quantity: 1 }],
      paymentMethod: 'upi',
    });
    expect(parsed.success).toBe(true);
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
      categoryId: 'womens-apparel-accessories',
      subcategoryId: 'jewellery-accessories',
      productType: 'Bangles',
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

  it('allows delivery partner assignment only once ready for pickup or after delivery failure', () => {
    expect(canAssignDeliveryPartner('ready_for_pickup', false)).toBe(true);
    expect(canAssignDeliveryPartner('preparing', false)).toBe(false);
    expect(canAssignDeliveryPartner('out_for_delivery', true)).toBe(false);
    expect(canAssignDeliveryPartner('delivery_failed', true)).toBe(true);
    expect(canAssignDeliveryPartner('delivered', false)).toBe(false);
  });

  it('sets status to delivery_partner_assigned when a partner is assigned for delivery', () => {
    expect(statusAfterDeliveryPartnerAssignment('delivery_failed')).toBe('delivery_partner_assigned');
    expect(statusAfterDeliveryPartnerAssignment('ready_for_pickup')).toBe('delivery_partner_assigned');
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
      categoryId: 'womens-apparel-accessories',
      subcategoryId: 'jewellery-accessories',
      productType: 'Bangles',
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
    expect(response.body.data.map((category: { categoryName: string }) => category.categoryName)).toEqual([
      'Home and Living',
      "Women's Apparel and Accessories",
      "Men's Apparel and Accessories",
      'Personal Care',
      'Food Items',
      'Kids Toys & Accessories',
    ]);
    expect(response.body.data.some((category: { categoryName: string }) => ['Bangles', 'Jewellery', 'Dupattas', 'Others'].includes(category.categoryName))).toBe(false);
  });

  it('serves the product category alias', async () => {
    const response = await request(app).get('/api/v1/products/categories');

    expect(response.status).toBe(200);
    expect(response.body.data.map((category: { categoryId: string }) => category.categoryId)).toEqual(categoryMaster.map((category) => category.categoryId));
  });

  it('accounts for every workbook product row and maps legacy types under marketplace categories', () => {
    expect(productMaster).toHaveLength(157);
    expect(new Set(productMaster.map((product) => product.sourceRow)).size).toBe(157);
    expect(Math.min(...productMaster.map((product) => product.sourceRow))).toBe(2);
    expect(Math.max(...productMaster.map((product) => product.sourceRow))).toBe(158);
    expect(productMaster.filter((product) => product.classificationStatus === 'needs_review')).toHaveLength(8);

    const bangles = productMaster.filter((product) => product.sourceCategory === 'Bangles');
    expect(bangles.length).toBeGreaterThan(0);
    expect(bangles.every((product) => product.categoryId === 'womens-apparel-accessories' && product.subcategoryId === 'jewellery-accessories')).toBe(true);
    const dupattas = productMaster.filter((product) => product.sourceCategory === 'Dupattas');
    expect(dupattas.length).toBeGreaterThan(0);
    expect(dupattas.every((product) => product.categoryId === 'womens-apparel-accessories' && product.subcategoryId === 'dupattas-scarves')).toBe(true);
    const foodProducts = productMaster.filter((product) => product.isFoodProduct);
    expect(foodProducts.length).toBeGreaterThan(0);
    expect(foodProducts.every((product) => product.categoryId === 'food-items')).toBe(true);
    expect(getCategoryHierarchy()).toHaveLength(6);
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
    const zones = await request(app).get('/api/v1/city-admin/service-zones');
    const changeRequest = await request(app).post('/api/v1/city-admin/service-zone-change-requests').send({ requestText: 'Add PIN code coverage.' });
    const sellers = await request(app).get('/api/v1/city-admin/sellers');
    const products = await request(app).get('/api/v1/city-admin/products');
    const productFlag = await request(app).post('/api/v1/city-admin/products/64a1b2c3d4e5f6a7b8c9d0e1/flags').send({ reason: 'Misleading listing details.' });
    const partners = await request(app).get('/api/v1/city-admin/delivery-partners');
    const partnerApplications = await request(app).get('/api/v1/city-admin/delivery-partner-applications');
    const orderDetail = await request(app).get('/api/v1/city-admin/orders/64a1b2c3d4e5f6a7b8c9d0e1');
    const assignment = await request(app).put('/api/v1/city-admin/orders/64a1b2c3d4e5f6a7b8c9d0e1/delivery-partner').send({ partnerId: '64a1b2c3d4e5f6a7b8c9d0e1' });
    const orders = await request(app).get('/api/v1/city-admin/orders');

    expect(dashboard.status).toBe(401);
    expect(dashboard.body.error.code).toBe('UNAUTHORIZED');
    expect(zones.status).toBe(401);
    expect(zones.body.error.code).toBe('UNAUTHORIZED');
    expect(changeRequest.status).toBe(401);
    expect(changeRequest.body.error.code).toBe('UNAUTHORIZED');
    expect(sellers.status).toBe(401);
    expect(sellers.body.error.code).toBe('UNAUTHORIZED');
    expect(products.status).toBe(401);
    expect(products.body.error.code).toBe('UNAUTHORIZED');
    expect(productFlag.status).toBe(401);
    expect(productFlag.body.error.code).toBe('UNAUTHORIZED');
    expect(partners.status).toBe(401);
    expect(partners.body.error.code).toBe('UNAUTHORIZED');
    expect(partnerApplications.status).toBe(401);
    expect(partnerApplications.body.error.code).toBe('UNAUTHORIZED');
    expect(orderDetail.status).toBe(401);
    expect(orderDetail.body.error.code).toBe('UNAUTHORIZED');
    expect(assignment.status).toBe(401);
    expect(assignment.body.error.code).toBe('UNAUTHORIZED');
    expect(orders.status).toBe(401);
    expect(orders.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns not-ready until the database is connected', async () => {
    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('NOT_READY');
  });
});
