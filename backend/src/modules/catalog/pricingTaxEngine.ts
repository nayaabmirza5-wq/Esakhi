/**
 * Indian Hyperlocal E-Commerce Pricing & Tax Engine
 * Compliant with:
 * - Legal Metrology (Packaged Commodities) Rules (MRP Ceiling)
 * - GST Acts (CGST/SGST 50/50 intra-state, IGST inter-state)
 * - Section 52 of CGST Act (0.5% GST TCS for registered e-commerce sellers)
 * - Section 194-O of Income Tax Act (0.1% TDS on gross e-commerce sales > ₹5,00,000)
 * - ₹30 Minimum Line-Item Value & Automatic Bulk MOQ rule
 * - 60-Day Minimum Shelf-Life Rule
 * - Strict Product Scope (Packaged non-perishable goods with defined shelf life only)
 */

export type SellerTaxProfile = 'GST_REGISTERED' | 'NON_GST_ENROLMENT';

export const PERMITTED_CATEGORIES = [
  'packaged_fmcg_snacks',
  'personal_care_cosmetics',
  'electronics_mobile_accessories',
  'fashion_apparel',
  'home_kitchen_stationery',
  // Backward compatibility aliases
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

// Strictly prohibited product keywords (Fresh foods, cooked meals, loose produce, pharmacy/medicines)
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
  minOrderQuantity?: number | undefined;
  isInterState?: boolean | undefined;
  sellerAnnualSalesExceeds5Lakh?: boolean | undefined;
}

export interface ProductFinancialsResult {
  // Pricing
  sellerBasePrice: number;
  printedUnitMrp: number;
  embeddedPlatformMargin: number;
  customerUnitPrice: number;
  moqFloor: number;
  isMoqLocked: boolean;
  minOrderQuantity: number;
  packSellingPrice: number;
  sellerPackBaseValue: number;

  // Tax Profile & Rates
  sellerTaxProfile: SellerTaxProfile;
  productGstRate: number;
  categoryCommissionRate: number;

  // Product GST Breakdown
  taxableValue: number;
  productGstAmount: number;
  cgst: number;
  sgst: number;
  igst: number;

  // Deductions from Seller Pack Payout
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

  // Net Bank Payout
  netBankPayout: number;

  // Validation
  isValid: boolean;
  errorMessage?: string;
}

/**
 * Standard rounding to 2 decimal places (paise precision)
 */
function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Validates that product strictly falls under permitted non-perishable packaged goods
 * and does not contain fresh produce, cooked meals, or pharmacy items.
 */
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
        error: `Strict Product Scope Violation: Products containing "${keyword}" are not permitted. Only packaged non-perishable goods with a defined shelf life are supported. Fresh food, cooked meals, loose produce, and pharmacy items are strictly prohibited.`,
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

/**
 * Validates best before / expiry date is at least 60 days ahead of today.
 * Accepts formats: YYYY-MM, YYYY-MM-DD, MM/YYYY
 */
export function validateShelfLife(bestBeforeDate: string, referenceDate: Date = new Date()): {
  isValid: boolean;
  daysRemaining: number;
  error?: string;
} {
  if (!bestBeforeDate || typeof bestBeforeDate !== 'string') {
    return {
      isValid: false,
      daysRemaining: 0,
      error: 'Mandatory Shelf-Life: Expiry Month/Year (best_before_date) is required.',
    };
  }

  let expiryDate: Date;
  const trimmed = bestBeforeDate.trim();

  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const parts = trimmed.split('-');
    const year = Number(parts[0]) || 0;
    const month = Number(parts[1]) || 1;
    // End of the specified month
    expiryDate = new Date(year, month, 0, 23, 59, 59);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    expiryDate = new Date(trimmed);
  } else if (/^\d{2}\/\d{4}$/.test(trimmed)) {
    const parts = trimmed.split('/');
    const month = Number(parts[0]) || 1;
    const year = Number(parts[1]) || 0;
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
      error: `Mandatory Shelf-Life Violation: The expiry date (${trimmed}) has only ${Math.max(
        0,
        daysRemaining
      )} days remaining. Hyperlocal platform regulations require at least 60 days of shelf life.`,
    };
  }

  return { isValid: true, daysRemaining };
}

/**
 * Core Pricing, Legal Metrology, MOQ, and Indian Tax Ledger Calculator
 */
export function calculateProductFinancials(input: ProductFinancialsInput): ProductFinancialsResult {
  const sellerBasePrice = round2(Number(input.sellerBasePrice) || 0);
  const printedUnitMrp = round2(Number(input.printedUnitMrp) || 0);
  const productGstRate = Number(input.productGstRate) || 0;
  const sellerTaxProfile = input.sellerTaxProfile || 'GST_REGISTERED';
  const isInterState = Boolean(input.isInterState);
  const sellerAnnualSalesExceeds5Lakh = Boolean(input.sellerAnnualSalesExceeds5Lakh);

  // 1. Legal Metrology MRP Ceiling Check
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

  // 2. Embedded Platform Margin Calculation
  // customer_unit_price MUST NEVER exceed printed_unit_mrp
  // If seller_base_price < printed_unit_mrp, embed platform margin up to printed_unit_mrp ceiling
  // If seller_base_price === printed_unit_mrp, keep customer_unit_price = printed_unit_mrp (₹0 margin)
  let customerUnitPrice = printedUnitMrp;
  let embeddedPlatformMargin = 0;

  if (sellerBasePrice < printedUnitMrp) {
    // 5% standard platform markup or difference up to MRP
    const targetMarkup = round2(sellerBasePrice * 0.05);
    const cappedMargin = Math.min(round2(printedUnitMrp - sellerBasePrice), targetMarkup);
    customerUnitPrice = round2(sellerBasePrice + cappedMargin);
    embeddedPlatformMargin = round2(customerUnitPrice - sellerBasePrice);
  } else {
    customerUnitPrice = printedUnitMrp;
    embeddedPlatformMargin = 0;
  }

  // 3. ₹30 Minimum Line-Item Value & Automatic Bulk MOQ:
  // Whenever unit_selling_price < ₹30, auto-lock MOQ = Math.ceil(30 / unit_selling_price)
  let moqFloor = 1;
  let isMoqLocked = false;

  if (customerUnitPrice < 30 && customerUnitPrice > 0) {
    moqFloor = Math.ceil(30 / customerUnitPrice);
    isMoqLocked = true;
  }

  const requestedMoq = Number(input.minOrderQuantity) || moqFloor;
  // Seller cannot set MOQ lower than calculated floor
  const effectiveMoq = Math.max(moqFloor, requestedMoq);

  // Pack Selling Price (Gross value paid by customer for this line-item pack)
  const packSellingPrice = round2(customerUnitPrice * effectiveMoq);
  const sellerPackBaseValue = round2(sellerBasePrice * effectiveMoq);

  // 4. Commission Rate by Category
  const normalizedCat = (input.category || '').trim().toLowerCase();
  const categoryCommissionRate =
    CATEGORY_COMMISSION_RATES[normalizedCat] ??
    Object.entries(CATEGORY_COMMISSION_RATES).find(([key]) => normalizedCat.includes(key))?.[1] ??
    10; // Default 10% if unknown

  // 5. Product GST & Taxable Value Breakdown
  let taxableValue = packSellingPrice;
  let productGstAmount = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  if (sellerTaxProfile === 'GST_REGISTERED' && productGstRate > 0) {
    // Price is inclusive of Product GST
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
    // NON_GST_ENROLMENT: 0% Product GST, taxable_value = pack_selling_price
    taxableValue = packSellingPrice;
    productGstAmount = 0;
    cgst = 0;
    sgst = 0;
    igst = 0;
  }

  // 6. Deductions from Seller Pack Payout
  // a) Category Commission Slab on taxable_value
  const commissionAmount = round2(taxableValue * (categoryCommissionRate / 100));

  // b) 18% GST on Commission (CGST 9% + SGST 9% or IGST 18%)
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

  // c) 0.5% GST TCS: If GST_REGISTERED, 0.5% of taxable_value (0.25% CGST + 0.25% SGST); if NON_GST, 0%
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

  // d) 0.1% Income Tax TDS (u/s 194-O): If seller annual sales > ₹5,00,000, 0.1% of gross pack value; else 0%
  let incomeTaxTdsAmount = 0;
  if (sellerAnnualSalesExceeds5Lakh) {
    incomeTaxTdsAmount = round2(packSellingPrice * 0.001);
  }

  // Total deductions
  const totalDeductions = round2(commissionAmount + gstOnCommission + gstTcsAmount + incomeTaxTdsAmount);

  // e) Net Bank Payout: pack_selling_price - commission - gst_on_commission - gst_tcs - income_tax_tds
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

export const FIVE_LAKH_THRESHOLD_PAISE = 50_000_000; // ₹5,00,000 in paise

export function getIndianFinancialYearBounds(referenceDate: Date = new Date()): {
  fyStart: Date;
  fyEnd: Date;
  fyLabel: string;
} {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth(); // 0 = Jan, 3 = Apr
  const startYear = month >= 3 ? year : year - 1;
  const endYear = startYear + 1;
  const fyStart = new Date(Date.UTC(startYear, 3, 1, 0, 0, 0, 0));
  const fyEnd = new Date(Date.UTC(endYear, 2, 31, 23, 59, 59, 999));
  return {
    fyStart,
    fyEnd,
    fyLabel: `FY ${startYear}-${String(endYear).slice(-2)}`,
  };
}

export interface SellerStatutoryTaxSummary {
  fyLabel: string;
  taxProfile: SellerTaxProfile;
  hasGst: boolean;
  gstin?: string | undefined;
  enrolmentId?: string | undefined;
  panNumber: string;
  stateCode: string;
  fyGrossSalesPaise: number;
  fiveLakhThresholdPaise: number;
  exceeds5LakhThreshold: boolean;
  thresholdProgressPercent: number;
  remainingBeforeTdsPaise: number;
  taxableSalesPaise: number;
  tcsRatePercent: number;
  tcsCgstPaise: number;
  tcsSgstPaise: number;
  tcsTotalPaise: number;
  tdsRatePercent: number;
  tds194OPaise: number;
  govtReportingFormTcs: string;
  govtReportingFormTds: string;
}

export function computeSellerStatutoryTaxSummary(params: {
  fyGrossSalesPaise: number;
  periodGrossSalesPaise: number;
  hasGst?: boolean | undefined;
  gstin?: string | undefined;
  enrolmentId?: string | undefined;
  panNumber?: string | undefined;
  averageGstRatePercent?: number | undefined;
  referenceDate?: Date | undefined;
}): SellerStatutoryTaxSummary {
  const { fyLabel } = getIndianFinancialYearBounds(params.referenceDate);
  const isGst = Boolean(params.hasGst && params.gstin && params.gstin.trim().length > 0);
  const taxProfile: SellerTaxProfile = isGst ? 'GST_REGISTERED' : 'NON_GST_ENROLMENT';

  const gstin = isGst ? params.gstin!.trim().toUpperCase() : undefined;
  const enrolmentId = !isGst
    ? (params.enrolmentId?.trim().toUpperCase() || 'ENR-MP-470661-0012')
    : undefined;
  const panNumber =
    params.panNumber?.trim().toUpperCase() ||
    (gstin && gstin.length >= 12 ? gstin.slice(2, 12) : 'ABCDE1234F');

  const fyGrossSalesPaise = Math.max(0, Math.round(params.fyGrossSalesPaise || 0));
  const periodGrossSalesPaise = Math.max(0, Math.round(params.periodGrossSalesPaise || 0));

  const exceeds5LakhThreshold = fyGrossSalesPaise > FIVE_LAKH_THRESHOLD_PAISE;
  const thresholdProgressPercent = Math.min(
    100,
    Math.round((fyGrossSalesPaise / FIVE_LAKH_THRESHOLD_PAISE) * 1000) / 10,
  );
  const remainingBeforeTdsPaise = Math.max(0, FIVE_LAKH_THRESHOLD_PAISE - fyGrossSalesPaise);

  // Taxable sales & Section 52 GST TCS (0.5% = 0.25% CGST + 0.25% SGST for GSTIN sellers; 0% for Enrolment ID sellers)
  const avgGst = isGst ? (params.averageGstRatePercent ?? 5) : 0;
  const taxableSalesPaise =
    isGst && avgGst > 0
      ? Math.round(periodGrossSalesPaise / (1 + avgGst / 100))
      : periodGrossSalesPaise;

  const tcsRatePercent = isGst ? 0.5 : 0;
  const tcsTotalPaise = isGst ? Math.round(taxableSalesPaise * 0.005) : 0;
  const tcsCgstPaise = isGst ? Math.round(tcsTotalPaise / 2) : 0;
  const tcsSgstPaise = isGst ? tcsTotalPaise - tcsCgstPaise : 0;

  // Section 194-O Income Tax TDS:
  // 0.1% on gross e-commerce sales once seller's FY gross sales cross ₹5,00,000 (50,000,000 paise)
  const tdsRatePercent = exceeds5LakhThreshold ? 0.1 : 0;
  const tds194OPaise = exceeds5LakhThreshold ? Math.round(periodGrossSalesPaise * 0.001) : 0;

  return {
    fyLabel,
    taxProfile,
    hasGst: isGst,
    gstin,
    enrolmentId,
    panNumber,
    stateCode: '23 (Madhya Pradesh)',
    fyGrossSalesPaise,
    fiveLakhThresholdPaise: FIVE_LAKH_THRESHOLD_PAISE,
    exceeds5LakhThreshold,
    thresholdProgressPercent,
    remainingBeforeTdsPaise,
    taxableSalesPaise,
    tcsRatePercent,
    tcsCgstPaise,
    tcsSgstPaise,
    tcsTotalPaise,
    tdsRatePercent,
    tds194OPaise,
    govtReportingFormTcs: isGst ? 'GSTR-8 Table 3 (GSTIN TCS)' : 'GSTR-8 Table 4B (Enrolment ID)',
    govtReportingFormTds: exceeds5LakhThreshold ? 'Form 26Q / Form 16A (Sec 194-O)' : 'Exempt u/s 194-O Proviso (≤ ₹5L)',
  };
}

