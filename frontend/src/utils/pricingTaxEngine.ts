/**
 * Indian Hyperlocal E-Commerce Pricing & Tax Engine (Frontend Shared Utility)
 * Live calculation utility matching backend settlement engine
 */

export type SellerTaxProfile = 'GST_REGISTERED' | 'NON_GST_ENROLMENT';

export const PERMITTED_CATEGORIES = [
  'packaged_fmcg_snacks',
  'personal_care_cosmetics',
  'electronics_mobile_accessories',
  'fashion_apparel',
  'home_kitchen_stationery',
  'food-items',
  'personal-care',
  'womens-apparel-accessories',
  'mens-apparel-accessories',
  'home-and-living',
  'kids-toys-accessories',
] as const;

export const CATEGORY_COMMISSION_RATES: Record<string, number> = {
  packaged_fmcg_snacks: 8, // 8%
  'food-items': 8,
  personal_care_cosmetics: 10, // 10%
  'personal-care': 10,
  electronics_mobile_accessories: 12, // 12%
  fashion_apparel: 15, // 15%
  'womens-apparel-accessories': 15,
  'mens-apparel-accessories': 15,
  home_kitchen_stationery: 12, // 12%
  'home-and-living': 12,
  'kids-toys-accessories': 12,
};

export const PROHIBITED_SCOPE_KEYWORDS = [
  'cooked',
  'hot meal',
  'curry',
  'biryani',
  'roti',
  'sabzi',
  'thali',
  'fresh vegetable',
  'fresh fruit',
  'loose onion',
  'loose potato',
  'loose tomato',
  'loose produce',
  'raw meat',
  'fresh chicken',
  'fresh fish',
  'fresh mutton',
  'fresh milk',
  'loose paneer',
  'paracetamol',
  'antibiotic',
  'cough syrup',
  'prescription',
  'capsule',
  'tablet',
  'injection',
  'pharma',
  'pharmacy',
  'medicine',
  'drug',
  'ointment',
];

export interface ProductFinancialsInput {
  sellerBasePrice: number; // in Rupees
  printedUnitMrp: number; // in Rupees
  category: string;
  productGstRate: number; // 0, 5, 12, 18, 28
  sellerTaxProfile: SellerTaxProfile;
  minOrderQuantity?: number;
  isInterState?: boolean;
  sellerAnnualSalesExceeds5Lakh?: boolean;
}

export interface ProductFinancialsResult {
  sellerBasePrice: number;
  printedUnitMrp: number;
  embeddedPlatformMargin: number;
  customerUnitPrice: number;
  moqFloor: number;
  isMoqLocked: boolean;
  minOrderQuantity: number;
  packSellingPrice: number;
  sellerPackBaseValue: number;

  sellerTaxProfile: SellerTaxProfile;
  productGstRate: number;
  categoryCommissionRate: number;

  taxableValue: number;
  productGstAmount: number;
  cgst: number;
  sgst: number;
  igst: number;

  commissionAmount: number;
  gstOnCommission: number;
  commissionCgst: number;
  commissionSgst: number;
  commissionIgst: number;
  gstTcsAmount: number;
  tcsCgst: number;
  tcsSgst: number;
  tcsIgst: number;
  incomeTaxTdsAmount: number;
  totalDeductions: number;

  netBankPayout: number;

  isValid: boolean;
  errorMessage?: string;
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function validateProductScope(payload: {
  category: string;
  name: string;
  description?: string;
}): { isValid: boolean; error?: string } {
  const normalizedCategory = payload.category.trim().toLowerCase();
  const textToCheck = `${payload.name} ${payload.description || ''}`.toLowerCase();

  for (const keyword of PROHIBITED_SCOPE_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(textToCheck)) {
      return {
        isValid: false,
        error: `Strict Product Scope: "${keyword}" is not permitted. Only packaged non-perishable goods with a defined shelf life are allowed. Fresh food, cooked meals, loose produce, and pharmacy items are strictly excluded.`,
      };
    }
  }

  const isPermittedCategory = PERMITTED_CATEGORIES.some(
    (c) => c === normalizedCategory || normalizedCategory.includes(c) || c.includes(normalizedCategory)
  );

  if (!isPermittedCategory) {
    return {
      isValid: false,
      error: `Category "${payload.category}" is outside the permitted product scope. Allowed categories: Packaged FMCG/Snacks, Personal Care/Cosmetics, Electronics/Mobile Accessories, Fashion/Apparel, Home/Kitchen/Stationery.`,
    };
  }

  return { isValid: true };
}

export function validateShelfLife(bestBeforeDate: string, referenceDate: Date = new Date()): {
  isValid: boolean;
  daysRemaining: number;
  error?: string;
} {
  if (!bestBeforeDate || typeof bestBeforeDate !== 'string') {
    return {
      isValid: false,
      daysRemaining: 0,
      error: 'Expiry Month/Year (best_before_date) is required.',
    };
  }

  let expiryDate: Date;
  const trimmed = bestBeforeDate.trim();

  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const [year, month] = trimmed.split('-').map(Number);
    expiryDate = new Date(year, month, 0, 23, 59, 59);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    expiryDate = new Date(trimmed);
  } else if (/^\d{2}\/\d{4}$/.test(trimmed)) {
    const [month, year] = trimmed.split('/').map(Number);
    expiryDate = new Date(year, month, 0, 23, 59, 59);
  } else {
    expiryDate = new Date(trimmed);
  }

  if (isNaN(expiryDate.getTime())) {
    return {
      isValid: false,
      daysRemaining: 0,
      error: 'Invalid date format. Use Month/Year (YYYY-MM).',
    };
  }

  const diffMs = expiryDate.getTime() - referenceDate.getTime();
  const daysRemaining = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (daysRemaining < 60) {
    return {
      isValid: false,
      daysRemaining,
      error: `Shelf-Life Rule: Only ${Math.max(0, daysRemaining)} days remaining. Minimum 60 days required.`,
    };
  }

  return { isValid: true, daysRemaining };
}

export function calculateProductFinancials(input: ProductFinancialsInput): ProductFinancialsResult {
  const sellerBasePrice = round2(Number(input.sellerBasePrice) || 0);
  const printedUnitMrp = round2(Number(input.printedUnitMrp) || 0);
  const productGstRate = Number(input.productGstRate) || 0;
  const sellerTaxProfile = input.sellerTaxProfile || 'GST_REGISTERED';
  const isInterState = Boolean(input.isInterState);
  const sellerAnnualSalesExceeds5Lakh = Boolean(input.sellerAnnualSalesExceeds5Lakh);

  // 1. Legal Metrology MRP Ceiling
  if (sellerBasePrice > printedUnitMrp) {
    return {
      sellerBasePrice,
      printedUnitMrp,
      embeddedPlatformMargin: 0,
      customerUnitPrice: printedUnitMrp,
      moqFloor: 1,
      isMoqLocked: false,
      minOrderQuantity: 1,
      packSellingPrice: 0,
      sellerPackBaseValue: 0,
      sellerTaxProfile,
      productGstRate,
      categoryCommissionRate: 0,
      taxableValue: 0,
      productGstAmount: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      commissionAmount: 0,
      gstOnCommission: 0,
      commissionCgst: 0,
      commissionSgst: 0,
      commissionIgst: 0,
      gstTcsAmount: 0,
      tcsCgst: 0,
      tcsSgst: 0,
      tcsIgst: 0,
      incomeTaxTdsAmount: 0,
      totalDeductions: 0,
      netBankPayout: 0,
      isValid: false,
      errorMessage: `Legal Metrology MRP Ceiling Violation: Seller base price (₹${sellerBasePrice}) cannot exceed printed unit MRP (₹${printedUnitMrp}).`,
    };
  }

  // 2. Embedded Platform Margin
  let customerUnitPrice = printedUnitMrp;
  let embeddedPlatformMargin = 0;

  if (sellerBasePrice < printedUnitMrp) {
    const targetMarkup = round2(sellerBasePrice * 0.05);
    const cappedMargin = Math.min(round2(printedUnitMrp - sellerBasePrice), targetMarkup);
    customerUnitPrice = round2(sellerBasePrice + cappedMargin);
    embeddedPlatformMargin = round2(customerUnitPrice - sellerBasePrice);
  } else {
    customerUnitPrice = printedUnitMrp;
    embeddedPlatformMargin = 0;
  }

  // 3. ₹30 Minimum Line-Item Value & Automatic Bulk MOQ:
  let moqFloor = 1;
  let isMoqLocked = false;

  if (customerUnitPrice < 30 && customerUnitPrice > 0) {
    moqFloor = Math.ceil(30 / customerUnitPrice);
    isMoqLocked = true;
  }

  const requestedMoq = Number(input.minOrderQuantity) || moqFloor;
  const effectiveMoq = Math.max(moqFloor, requestedMoq);

  const packSellingPrice = round2(customerUnitPrice * effectiveMoq);
  const sellerPackBaseValue = round2(sellerBasePrice * effectiveMoq);

  // 4. Commission Rate by Category
  const normalizedCat = (input.category || '').trim().toLowerCase();
  const categoryCommissionRate =
    CATEGORY_COMMISSION_RATES[normalizedCat] ??
    Object.entries(CATEGORY_COMMISSION_RATES).find(([key]) => normalizedCat.includes(key))?.[1] ??
    10;

  // 5. Product GST & Taxable Value Breakdown
  let taxableValue = packSellingPrice;
  let productGstAmount = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  if (sellerTaxProfile === 'GST_REGISTERED' && productGstRate > 0) {
    taxableValue = round2(packSellingPrice / (1 + productGstRate / 100));
    productGstAmount = round2(packSellingPrice - taxableValue);

    if (isInterState) {
      igst = productGstAmount;
      cgst = 0;
      sgst = 0;
    } else {
      cgst = round2(productGstAmount / 2);
      sgst = round2(productGstAmount - cgst);
      igst = 0;
    }
  } else {
    taxableValue = packSellingPrice;
    productGstAmount = 0;
    cgst = 0;
    sgst = 0;
    igst = 0;
  }

  // 6. Deductions from Seller Pack Payout
  const commissionAmount = round2(taxableValue * (categoryCommissionRate / 100));
  const gstOnCommission = round2(commissionAmount * 0.18);
  let commissionCgst = 0;
  let commissionSgst = 0;
  let commissionIgst = 0;

  if (isInterState) {
    commissionIgst = gstOnCommission;
  } else {
    commissionCgst = round2(gstOnCommission / 2);
    commissionSgst = round2(gstOnCommission - commissionCgst);
  }

  let gstTcsAmount = 0;
  let tcsCgst = 0;
  let tcsSgst = 0;
  let tcsIgst = 0;

  if (sellerTaxProfile === 'GST_REGISTERED') {
    gstTcsAmount = round2(taxableValue * 0.005);
    if (isInterState) {
      tcsIgst = gstTcsAmount;
    } else {
      tcsCgst = round2(gstTcsAmount / 2);
      tcsSgst = round2(gstTcsAmount - tcsCgst);
    }
  }

  let incomeTaxTdsAmount = 0;
  if (sellerAnnualSalesExceeds5Lakh) {
    incomeTaxTdsAmount = round2(packSellingPrice * 0.001);
  }

  const totalDeductions = round2(commissionAmount + gstOnCommission + gstTcsAmount + incomeTaxTdsAmount);
  const netBankPayout = round2(Math.max(0, packSellingPrice - totalDeductions));

  return {
    sellerBasePrice,
    printedUnitMrp,
    embeddedPlatformMargin,
    customerUnitPrice,
    moqFloor,
    isMoqLocked,
    minOrderQuantity: effectiveMoq,
    packSellingPrice,
    sellerPackBaseValue,
    sellerTaxProfile,
    productGstRate,
    categoryCommissionRate,
    taxableValue,
    productGstAmount,
    cgst,
    sgst,
    igst,
    commissionAmount,
    gstOnCommission,
    commissionCgst,
    commissionSgst,
    commissionIgst,
    gstTcsAmount,
    tcsCgst,
    tcsSgst,
    tcsIgst,
    incomeTaxTdsAmount,
    totalDeductions,
    netBankPayout,
    isValid: true,
  };
}
