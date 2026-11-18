import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;

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

describe('Merchant API & Product Creation Service', () => {
  describe('GET /api/merchant/master-catalogue', () => {
    it('returns the list of master SKUs with barcodes and MRP', async () => {
      const response = await request(app).get('/api/merchant/master-catalogue');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.items.length).toBeGreaterThan(0);
      const parleG = response.body.data.items.find((item: any) => item.masterSku === 'SKU-FMCG-PARLE-G-250G');
      expect(parleG).toBeDefined();
      expect(parleG.barcode).toBe('8901719101015');
      expect(parleG.printedUnitMrp).toBe(30);
    });

    it('filters master SKUs by search query barcode', async () => {
      const response = await request(app).get('/api/merchant/master-catalogue?q=8901719101015');

      expect(response.status).toBe(200);
      expect(response.body.data.items.length).toBe(1);
      expect(response.body.data.items[0].masterSku).toBe('SKU-FMCG-PARLE-G-250G');
    });
  });

  describe('POST /api/merchant/products authentication and validation', () => {
    it('rejects unauthenticated requests to add product with 401', async () => {
      const response = await request(app)
        .post('/api/merchant/products')
        .send({
          name: 'Parle-G Gold Biscuits 250g',
          categoryId: 'packaged_fmcg_snacks',
          description: 'Crisp biscuits',
          printedUnitMrp: 30,
          sellerBasePrice: 27,
          bestBeforeDate: '2027-06',
        });

      expect(response.status).toBe(401);
    });
  });
});
