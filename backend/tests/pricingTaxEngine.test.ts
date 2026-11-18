import { describe, it, expect } from 'vitest';
import {
  calculateProductFinancials,
  validateProductScope,
  validateShelfLife,
} from '../src/modules/catalog/pricingTaxEngine.js';

describe('Pricing, Tax & Legal Metrology Engine', () => {
  describe('1. Legal Metrology MRP Ceiling & Embedded Margin', () => {
    it('rejects when sellerBasePrice > printedUnitMrp', () => {
      const result = calculateProductFinancials({
        sellerBasePrice: 105,
        printedUnitMrp: 100,
        category: 'packaged_fmcg_snacks',
        productGstRate: 18,
        sellerTaxProfile: 'GST_REGISTERED',
      });

      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain('Legal Metrology MRP Ceiling Violation');
    });

    it('embeds platform margin up to MRP when sellerBasePrice < printedUnitMrp', () => {
      // Base: ₹40, MRP: ₹50. Standard 5% platform margin = ₹2. Customer unit price = ₹42
      const result = calculateProductFinancials({
        sellerBasePrice: 40,
        printedUnitMrp: 50,
        category: 'personal_care_cosmetics',
        productGstRate: 18,
        sellerTaxProfile: 'GST_REGISTERED',
      });

      expect(result.isValid).toBe(true);
      expect(result.customerUnitPrice).toBe(42);
      expect(result.embeddedPlatformMargin).toBe(2);
      expect(result.customerUnitPrice).toBeLessThanOrEqual(result.printedUnitMrp);
    });

    it('keeps customerUnitPrice equal to printedUnitMrp (₹0 embedded margin) when sellerBasePrice === printedUnitMrp', () => {
      const result = calculateProductFinancials({
        sellerBasePrice: 100,
        printedUnitMrp: 100,
        category: 'electronics_mobile_accessories',
        productGstRate: 18,
        sellerTaxProfile: 'GST_REGISTERED',
      });

      expect(result.isValid).toBe(true);
      expect(result.customerUnitPrice).toBe(100);
      expect(result.embeddedPlatformMargin).toBe(0);
    });
  });

  describe('2. ₹30 Minimum Line-Item Value & Automatic Bulk MOQ', () => {
    it('automatically calculates and locks MOQ = 6 for a ₹5 chips packet (pack total = ₹30)', () => {
      const result = calculateProductFinancials({
        sellerBasePrice: 5,
        printedUnitMrp: 5,
        category: 'packaged_fmcg_snacks',
        productGstRate: 12,
        sellerTaxProfile: 'GST_REGISTERED',
      });

      expect(result.customerUnitPrice).toBe(5);
      expect(result.moqFloor).toBe(6); // Math.ceil(30 / 5) = 6
      expect(result.isMoqLocked).toBe(true);
      expect(result.minOrderQuantity).toBe(6);
      expect(result.packSellingPrice).toBe(30); // 5 * 6 = ₹30
    });

    it('automatically calculates and locks MOQ = 3 for a ₹10 item (pack total = ₹30)', () => {
      const result = calculateProductFinancials({
        sellerBasePrice: 10,
        printedUnitMrp: 10,
        category: 'packaged_fmcg_snacks',
        productGstRate: 12,
        sellerTaxProfile: 'GST_REGISTERED',
      });

      expect(result.customerUnitPrice).toBe(10);
      expect(result.moqFloor).toBe(3); // Math.ceil(30 / 10) = 3
      expect(result.isMoqLocked).toBe(true);
      expect(result.minOrderQuantity).toBe(3);
      expect(result.packSellingPrice).toBe(30);
    });

    it('automatically calculates and locks MOQ = 2 for a ₹20 item (pack total = ₹40)', () => {
      const result = calculateProductFinancials({
        sellerBasePrice: 20,
        printedUnitMrp: 20,
        category: 'packaged_fmcg_snacks',
        productGstRate: 12,
        sellerTaxProfile: 'GST_REGISTERED',
      });

      expect(result.customerUnitPrice).toBe(20);
      expect(result.moqFloor).toBe(2); // Math.ceil(30 / 20) = 2
      expect(result.isMoqLocked).toBe(true);
      expect(result.minOrderQuantity).toBe(2);
      expect(result.packSellingPrice).toBe(40);
    });

    it('does not lock MOQ for items ≥ ₹30 (MOQ floor = 1)', () => {
      const result = calculateProductFinancials({
        sellerBasePrice: 30,
        printedUnitMrp: 30,
        category: 'packaged_fmcg_snacks',
        productGstRate: 18,
        sellerTaxProfile: 'GST_REGISTERED',
      });

      expect(result.customerUnitPrice).toBe(30);
      expect(result.moqFloor).toBe(1);
      expect(result.isMoqLocked).toBe(false);
      expect(result.minOrderQuantity).toBe(1);
      expect(result.packSellingPrice).toBe(30);
    });

    it('allows sellers to set higher MOQ for larger wholesale packs, but prevents setting lower than floor', () => {
      const resultWithHigherMoq = calculateProductFinancials({
        sellerBasePrice: 5,
        printedUnitMrp: 5,
        category: 'packaged_fmcg_snacks',
        productGstRate: 12,
        sellerTaxProfile: 'GST_REGISTERED',
        minOrderQuantity: 12, // Wholesale carton of 12
      });

      expect(resultWithHigherMoq.minOrderQuantity).toBe(12);
      expect(resultWithHigherMoq.packSellingPrice).toBe(60);

      // Attempt setting lower than floor (e.g. 2 instead of 6)
      const resultWithInvalidLowerMoq = calculateProductFinancials({
        sellerBasePrice: 5,
        printedUnitMrp: 5,
        category: 'packaged_fmcg_snacks',
        productGstRate: 12,
        sellerTaxProfile: 'GST_REGISTERED',
        minOrderQuantity: 2,
      });

      expect(resultWithInvalidLowerMoq.minOrderQuantity).toBe(6); // Clamped to floor 6
    });
  });

  describe('3. Indian Tax Ledger & Deductions Engine', () => {
    it('correctly calculates GST Registered seller deductions for FMCG (8% commission)', () => {
      // ₹100 item, 18% GST rate, intra-state
      const result = calculateProductFinancials({
        sellerBasePrice: 100,
        printedUnitMrp: 100,
        category: 'packaged_fmcg_snacks',
        productGstRate: 18,
        sellerTaxProfile: 'GST_REGISTERED',
        isInterState: false,
      });

      // Taxable Value = 100 / 1.18 = 84.75
      expect(result.taxableValue).toBe(84.75);
      // Product GST = 100 - 84.75 = 15.25 (split 50/50: 7.63 CGST, 7.62 SGST)
      expect(result.productGstAmount).toBe(15.25);
      expect(result.cgst + result.sgst).toBe(15.25);
      expect(result.igst).toBe(0);

      // 8% Category Commission on taxable value: 84.75 * 0.08 = 6.78
      expect(result.commissionAmount).toBe(6.78);
      // 18% GST on Commission: 6.78 * 0.18 = 1.22 (0.61 CGST + 0.61 SGST)
      expect(result.gstOnCommission).toBe(1.22);
      expect(result.commissionCgst + result.commissionSgst).toBe(1.22);

      // 0.5% GST TCS on taxable value: 84.75 * 0.005 = 0.42
      expect(result.gstTcsAmount).toBe(0.42);

      // 0.1% TDS is 0 when sales <= 5 Lakh
      expect(result.incomeTaxTdsAmount).toBe(0);

      // Total Deductions = 6.78 + 1.22 + 0.42 = 8.42
      expect(result.totalDeductions).toBe(8.42);

      // Net Bank Payout = 100 - 8.42 = 91.58
      expect(result.netBankPayout).toBe(91.58);
    });

    it('correctly calculates Inter-State IGST routing', () => {
      const result = calculateProductFinancials({
        sellerBasePrice: 100,
        printedUnitMrp: 100,
        category: 'electronics_mobile_accessories', // 12% commission
        productGstRate: 18,
        sellerTaxProfile: 'GST_REGISTERED',
        isInterState: true,
      });

      expect(result.igst).toBe(15.25);
      expect(result.cgst).toBe(0);
      expect(result.sgst).toBe(0);
      expect(result.commissionIgst).toBe(result.gstOnCommission);
      expect(result.commissionCgst).toBe(0);
      expect(result.tcsIgst).toBe(result.gstTcsAmount);
      expect(result.tcsCgst).toBe(0);
    });

    it('charges 0% Product GST and 0% TCS for Non-GST Enrolment sellers', () => {
      const result = calculateProductFinancials({
        sellerBasePrice: 100,
        printedUnitMrp: 100,
        category: 'fashion_apparel', // 15% commission
        productGstRate: 12,
        sellerTaxProfile: 'NON_GST_ENROLMENT',
      });

      expect(result.taxableValue).toBe(100);
      expect(result.productGstAmount).toBe(0);
      expect(result.cgst).toBe(0);
      expect(result.sgst).toBe(0);
      expect(result.gstTcsAmount).toBe(0);

      // 15% Commission on 100 = 15.00
      expect(result.commissionAmount).toBe(15.0);
      // 18% GST on Commission = 15 * 0.18 = 2.70
      expect(result.gstOnCommission).toBe(2.7);

      // Net Bank Payout = 100 - 15 - 2.70 = 82.30
      expect(result.netBankPayout).toBe(82.3);
    });

    it('deducts 0.1% Section 194-O Income Tax TDS when seller annual sales > ₹5,00,000', () => {
      const result = calculateProductFinancials({
        sellerBasePrice: 1000,
        printedUnitMrp: 1000,
        category: 'home_kitchen_stationery', // 12% commission
        productGstRate: 18,
        sellerTaxProfile: 'GST_REGISTERED',
        sellerAnnualSalesExceeds5Lakh: true,
      });

      // 0.1% on 1000 = ₹1.00
      expect(result.incomeTaxTdsAmount).toBe(1.0);
      expect(result.totalDeductions).toBeGreaterThan(0);
    });
  });

  describe('4. Strict Product Scope Enforcement', () => {
    it('accepts valid packaged non-perishable categories', () => {
      const res = validateProductScope({
        category: 'packaged_fmcg_snacks',
        name: 'Haldiram Aloo Bhujia 400g',
        description: 'Packaged crispy potato sev namkeen',
      });
      expect(res.isValid).toBe(true);
    });

    it('rejects fresh cooked foods and restaurant meals', () => {
      const cookedCheck = validateProductScope({
        category: 'packaged_fmcg_snacks',
        name: 'Fresh Hot Biryani Bowl',
        description: 'Cooked basmati rice with spices',
      });
      expect(cookedCheck.isValid).toBe(false);
      expect(cookedCheck.error).toContain('Strict Product Scope');
    });

    it('rejects loose produce and fresh vegetables', () => {
      const vegCheck = validateProductScope({
        category: 'packaged_fmcg_snacks',
        name: 'Loose Onions 5kg',
        description: 'Fresh vegetable from local mandi',
      });
      expect(vegCheck.isValid).toBe(false);
      expect(vegCheck.error).toContain('Strict Product Scope');
    });

    it('rejects medicines, antibiotics, and pharmacy tablets', () => {
      const pharmaCheck = validateProductScope({
        category: 'personal_care_cosmetics',
        name: 'Paracetamol 650mg Tablets',
        description: 'Fever medicine prescription tablet',
      });
      expect(pharmaCheck.isValid).toBe(false);
      expect(pharmaCheck.error).toContain('Strict Product Scope');
    });
  });

  describe('5. Mandatory Shelf-Life Validation (>= 60 Days)', () => {
    it('accepts dates at least 60 days ahead of reference date', () => {
      const refDate = new Date(2026, 10, 16); // 16 Nov 2026
      const validDate = '2027-04'; // ~165 days ahead
      const check = validateShelfLife(validDate, refDate);
      expect(check.isValid).toBe(true);
      expect(check.daysRemaining).toBeGreaterThanOrEqual(60);
    });

    it('blocks submission if expiry date is less than 60 days ahead', () => {
      const refDate = new Date(2026, 10, 16); // 16 Nov 2026
      const tooSoonDate = '2026-12'; // ~44 days ahead
      const check = validateShelfLife(tooSoonDate, refDate);
      expect(check.isValid).toBe(false);
      expect(check.error).toContain('Mandatory Shelf-Life Violation');
    });

    it('blocks submission if product is already expired', () => {
      const refDate = new Date(2026, 10, 16); // 16 Nov 2026
      const pastDate = '2026-05';
      const check = validateShelfLife(pastDate, refDate);
      expect(check.isValid).toBe(false);
      expect(check.error).toContain('Mandatory Shelf-Life Violation');
    });
  });
});
