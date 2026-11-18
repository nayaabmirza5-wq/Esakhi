/**
 * Standardized SKU & EAN-13 Barcode Generator for eSakhi Marketplace
 * Format:
 * - Master SKU: ESK-<CAT_CODE>-<SHG_CODE>-<ITEM_CODE>-<HASH>
 * - Variant SKU: <MASTER_SKU>-<VARIANT_CODE>
 * - Barcode: GS1 India 890 prefix + 9 digits + Luhn/EAN-13 check digit
 */

const CATEGORY_SKU_PREFIX: Record<string, string> = {
  'womens-apparel-accessories': 'WAP',
  'mens-apparel-accessories': 'MAP',
  'fashion_apparel': 'FSH',
  'food-items': 'FD',
  'packaged_fmcg_snacks': 'FMCG',
  'home-and-living': 'HOM',
  'home_kitchen_stationery': 'HKS',
  'personal-care': 'PRC',
  'personal_care_cosmetics': 'PCC',
  'electronics_mobile_accessories': 'ELC',
  'kids-toys-accessories': 'KID',
  'art-crafts': 'ART',
};

function cleanAlphaNum(input: string, maxLen: number, fallback: string): string {
  const cleaned = (input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLen);
}

function deterministicShortHash(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const positive = Math.abs(hash) % 900 + 100; // 100..999
  return String(positive);
}

export function generateMasterSku(params: {
  categoryId?: string | undefined;
  brandOrShg?: string | undefined;
  productName: string;
  sellerId?: string | undefined;
}): string {
  const catKey = (params.categoryId || '').trim().toLowerCase();
  const catCode =
    CATEGORY_SKU_PREFIX[catKey] ||
    cleanAlphaNum(catKey, 3, 'GEN');

  const brandCode = cleanAlphaNum(params.brandOrShg || 'SHG', 3, 'SHG');

  // Extract meaningful consonant/word prefix from product name
  const words = (params.productName || 'ITEM')
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
    .filter(Boolean);

  let itemCode = '';
  if (words.length >= 2) {
    itemCode = (words[0]!.slice(0, 3) + words[1]!.slice(0, 3)).slice(0, 6);
  } else if (words.length === 1) {
    itemCode = words[0]!.slice(0, 6);
  } else {
    itemCode = 'CRAFT';
  }

  const hashSeed = `${catCode}-${brandCode}-${params.productName}-${params.sellerId || ''}`;
  const numSuffix = deterministicShortHash(hashSeed);

  return `ESK-${catCode}-${brandCode}-${itemCode}-${numSuffix}`;
}

export function generateVariantSku(
  masterSku: string,
  variantLabel: string | Record<string, string> | Map<string, string> | undefined,
  index = 0,
): string {
  const base = (masterSku || 'ESK-ITEM').trim().toUpperCase();
  let labelStr = '';

  if (typeof variantLabel === 'string') {
    labelStr = variantLabel;
  } else if (variantLabel instanceof Map) {
    const firstVal = Array.from(variantLabel.entries()).find(
      ([k]) => !['sellingprice', 'mrp'].includes(k.toLowerCase()),
    )?.[1];
    labelStr = firstVal || `V${index + 1}`;
  } else if (variantLabel && typeof variantLabel === 'object') {
    const firstVal = Object.entries(variantLabel).find(
      ([k]) => !['sellingprice', 'mrp'].includes(k.toLowerCase()),
    )?.[1];
    labelStr = firstVal || `V${index + 1}`;
  }

  // Convert e.g. "2.4 (Medium)" -> "24M", "250g" -> "250G", "Pack of 6" -> "PK6", "Free Size" -> "FREE"
  const upper = labelStr.trim().toUpperCase();
  let code = '';
  if (upper.includes('FREE')) {
    code = 'FREE';
  } else if (/^PACK OF (\d+)/i.test(upper)) {
    const m = upper.match(/^PACK OF (\d+)/i);
    code = `PK${m?.[1] || index + 1}`;
  } else if (/^SINGLE/i.test(upper)) {
    code = '1PC';
  } else if (/^(\d+)\.(\d+)/.test(upper)) {
    const m = upper.match(/^(\d+)\.(\d+)/);
    code = `B${m?.[1]}${m?.[2]}`;
  } else {
    code = cleanAlphaNum(upper, 6, `V${index + 1}`);
  }

  return `${base}-${code}`;
}

export function generateIndianBarcode(seed: string): string {
  // GS1 India prefix: 890 + 9 deterministic digits + 1 EAN-13 check digit
  let digits = '890';
  let acc = 5381;
  for (let i = 0; i < seed.length; i++) {
    acc = (acc * 33) ^ seed.charCodeAt(i);
  }
  const nineDigits = String(Math.abs(acc) % 1_000_000_000).padStart(9, '0');
  digits += nineDigits;

  // Compute EAN-13 check digit
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(digits[i]) || 0;
    sum += i % 2 === 0 ? d : d * 3;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return `${digits}${checkDigit}`;
}
