import { useState, useMemo, useEffect, useRef } from 'react';
import type { ReactNode, ChangeEvent } from 'react';
import { api } from '../../api';
import { displayError } from '../../ui';
import type { ProductCategory, SellerRecord } from '../../types';
import {
  calculateProductFinancials,
  type SellerTaxProfile,
} from '../../utils/pricingTaxEngine';
import {
  UploadCloud,
  Plus,
  Trash2,
  Package,
  Sparkles,
  Check,
  ChevronDown,
  ArrowLeft,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  Languages,
  AlertTriangle,
  HelpCircle,
  Layers,
  Scale,
  Tag,
  Copy,
} from 'lucide-react';
import { DAMOH_PRODUCT_TEMPLATES, type DamohProductTemplate } from './DamohProductTemplates';
import { MASTER_PRODUCT_CATALOG, findMasterProduct, type MasterCatalogProduct } from '../../data/masterProductCatalog';

function buildClientMasterSku(categoryId: string, brand: string, productName: string): string {
  const catMap: Record<string, string> = {
    'womens-apparel-accessories': 'WAP',
    'mens-apparel-accessories': 'MAP',
    'food-items': 'FD',
    'home-and-living': 'HOM',
    'personal-care': 'PRC',
    'packaged_fmcg_snacks': 'FMCG',
    'personal_care_cosmetics': 'PCC',
    'electronics_mobile_accessories': 'ELC',
    'fashion_apparel': 'FSH',
    'home_kitchen_stationery': 'HKS',
  };
  const catCode = catMap[categoryId] || (categoryId || 'GEN').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3) || 'GEN';
  const brandCode = (brand || 'SHG').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3) || 'SHG';
  const words = (productName || 'CRAFT')
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
    .filter(Boolean);
  const itemCode = words.length >= 2
    ? (words[0].slice(0, 3) + words[1].slice(0, 3)).slice(0, 6)
    : (words[0] || 'CRAFT').slice(0, 6);
  let hash = 2166136261;
  const seed = `${catCode}-${brandCode}-${productName}`;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const num = (Math.abs(hash) % 900) + 100;
  return `ESK-${catCode}-${brandCode}-${itemCode}-${num}`;
}

function buildClientVariantSku(masterSku: string, label: string, idx: number): string {
  const base = (masterSku || 'ESK-ITEM').trim().toUpperCase();
  const upper = (label || '').trim().toUpperCase();
  let suffix = '';
  if (upper.includes('FREE')) suffix = 'FREE';
  else if (/^PACK OF (\d+)/i.test(upper)) suffix = `PK${upper.match(/^PACK OF (\d+)/i)?.[1] || idx + 1}`;
  else if (/^SINGLE/i.test(upper)) suffix = '1PC';
  else if (/^(\d+)\.(\d+)/.test(upper)) {
    const m = upper.match(/^(\d+)\.(\d+)/);
    suffix = `B${m?.[1]}${m?.[2]}`;
  } else {
    suffix = upper.replace(/[^A-Z0-9]/g, '').slice(0, 6) || `V${idx + 1}`;
  }
  return `${base}-${suffix}`;
}

function buildClientBarcode(seed: string): string {
  let acc = 5381;
  for (let i = 0; i < seed.length; i++) {
    acc = (acc * 33) ^ seed.charCodeAt(i);
  }
  const nine = String(Math.abs(acc) % 1_000_000_000).padStart(9, '0');
  const twelve = `890${nine}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(twelve[i]) || 0;
    sum += i % 2 === 0 ? d : d * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return `${twelve}${check}`;
}

export type VariantDimensionType =
  | 'APPAREL_SIZE'
  | 'BANGLE_JEWELLERY'
  | 'WEIGHT_GRAMS'
  | 'VOLUME_ML'
  | 'PACK_COUNT';

export interface MeeshoSizeRow {
  id: string;
  label: string;
  sellingPrice: string;
  wrongDefectivePrice: string;
  mrp: string;
  stock: string;
  sku: string;
}

const DIMENSION_PRESETS: Record<
  VariantDimensionType,
  {
    titleEn: string;
    titleHi: string;
    attributeKey: string;
    subtitleEn: string;
    options: string[];
  }
> = {
  APPAREL_SIZE: {
    titleEn: 'Clothing / Saree / Apparel Sizes',
    titleHi: 'कपड़े / साड़ी / कुर्ती का साइज',
    attributeKey: 'Size',
    subtitleEn: 'Tick all clothing sizes you have in stock (like Meesho Apparel upload)',
    options: ['Free Size', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
  },
  BANGLE_JEWELLERY: {
    titleEn: 'Bangle / Kada / Jewellery Sizes & Sets',
    titleHi: 'चूड़ी / कंगन / ज्वेलरी का साइज व सेट',
    attributeKey: 'Bangle_Size',
    subtitleEn: 'Tick standard Indian bangle sizes (2.2, 2.4, 2.6, 2.8, 2.10) or pair/set options',
    options: [
      '2.2 (Small)',
      '2.4 (Medium)',
      '2.6 (Large)',
      '2.8 (XL)',
      '2.10 (XXL)',
      'Free Size (Adjustable)',
      'Pair (2 Bangles)',
      'Set of 4 Bangles',
      'Set of 6 Bangles',
      'Set of 12 (Dozen)',
    ],
  },
  WEIGHT_GRAMS: {
    titleEn: 'Weight / Grammage (Food, Pickles, Grocery, Spices)',
    titleHi: 'वजन के अनुसार (अचार, पापड़, मसाले, किराना)',
    attributeKey: 'Weight',
    subtitleEn: 'Tick all weight packs you sell (e.g. 250g, 500g, 1 kg)',
    options: ['50g', '100g', '200g', '250g', '500g', '1 kg', '2 kg', '5 kg'],
  },
  PACK_COUNT: {
    titleEn: 'Pack / Piece Quantity (Diyas, Handicrafts, Soaps, Combo)',
    titleHi: 'पैक / पीस संख्या (दीये, हस्तशिल्प, साबुन)',
    attributeKey: 'Pack',
    subtitleEn: 'Tick single piece or multi-piece combo packs',
    options: ['Single (1 Pc)', 'Pack of 2', 'Pack of 4', 'Pack of 6', 'Pack of 12', 'Pack of 24'],
  },
  VOLUME_ML: {
    titleEn: 'Liquid Volume (Oils, Honey, Sharbat, Herbal Wash)',
    titleHi: 'मात्रा / लीटर-मिलीलीटर (तेल, शहद, शरबत)',
    attributeKey: 'Volume',
    subtitleEn: 'Tick bottle or pouch volumes available',
    options: ['50 ml', '100 ml', '200 ml', '250 ml', '500 ml', '1 Litre'],
  },
};

export function SellerCatalogueListingPage({
  sellerRecord,
  onCancel,
  onSubmitted,
  onDraftSaved,
}: {
  sellerRecord?: SellerRecord | null;
  onCancel: () => void;
  onSubmitted: () => void;
  onDraftSaved?: (draft: any) => void;
}): ReactNode {
  const [lang, setLang] = useState<'en' | 'hi'>('en');

  // Derive tax regime directly from seller's registered account (default to Non-GST Enrolment ID for Damoh artisans)
  const isGstMerchant = Boolean(
    sellerRecord?.taxDetails?.hasGst && sellerRecord?.taxDetails?.gstin
  );
  const [taxProfile, setTaxProfile] = useState<SellerTaxProfile>(
    isGstMerchant ? 'GST_REGISTERED' : 'NON_GST_ENROLMENT'
  );
  const [registeredGstin, setRegisteredGstin] = useState<string>(
    sellerRecord?.taxDetails?.gstin || ''
  );
  const [registeredEnrolmentId, setRegisteredEnrolmentId] = useState<string>(
    sellerRecord?.taxDetails?.enrolmentId || 'ENR-MP-470661-0012'
  );

  // Categories from master
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [categoryId, setCategoryId] = useState('womens-apparel-accessories');
  const [subcategoryId, setSubcategoryId] = useState('sarees-clothing');
  const [productType, setProductType] = useState('Chanderi Saree');

  // Step 1: Photos
  const [imageUrls, setImageUrls] = useState<string[]>([
    'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80',
  ]);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Step 2: Meesho-style Size / Weight / Pack Quantity Matrix
  const [dimensionType, setDimensionType] = useState<VariantDimensionType>('APPAREL_SIZE');
  const [customSizeInput, setCustomSizeInput] = useState('');
  const [sizeRows, setSizeRows] = useState<MeeshoSizeRow[]>([
    {
      id: 'row-free-size',
      label: 'Free Size',
      sellingPrice: '1499',
      wrongDefectivePrice: '1449',
      mrp: '1999',
      stock: '20',
      sku: 'ESK-SAR-FREE',
    },
  ]);

  // Quick Bulk-Fill inputs for "Apply to All Selected Sizes"
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkMrp, setBulkMrp] = useState('');
  const [bulkStock, setBulkStock] = useState('');
  const [activePreviewRowIdx, setActivePreviewRowIdx] = useState<number>(0);

  // Step 3: Product Details & Dynamic Category Attributes
  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState(
    sellerRecord?.supplierDetails?.shgName || 'Aarohi Verma Collective'
  );
  const [description, setDescription] = useState('');
  const [netQuantity, setNetQuantity] = useState('1');
  const [weight, setWeight] = useState('450');
  const [weightUnit, setWeightUnit] = useState<'g' | 'kg'>('g');
  const [countryOfOrigin, setCountryOfOrigin] = useState('India');
  const lowStockThreshold = '5';
  const [sku, setSku] = useState('ESK-WAP-AAR-CHANSR-101');
  const [barcode, setBarcode] = useState('8904706610105');
  const [skuSearchInput, setSkuSearchInput] = useState('');

  // Dynamic Meesho-style Category Attributes
  const [attrFabricOrMaterial, setAttrFabricOrMaterial] = useState('Chanderi Silk');
  const [attrPatternOrType, setAttrPatternOrType] = useState('Zari Woven');
  const [attrOccasionOrShelfLife, setAttrOccasionOrShelfLife] = useState('Festive & Wedding');
  const [attrPackOrBlouseInfo, setAttrPackOrBlouseInfo] = useState('With Running Blouse Piece');

  // Tax & Compliance
  const [gstRate, setGstRate] = useState<number>(isGstMerchant ? 5 : 0);
  const [hsnCode, setHSNCode] = useState(isGstMerchant ? '5208' : '');
  const [chargeTax, setChargeTax] = useState(isGstMerchant);
  const [showTaxHelp, setShowTaxHelp] = useState(false);
  const [annualSalesExceeds5Lakh, setAnnualSalesExceeds5Lakh] = useState(false);
  const [fyGrossSalesPaise, setFyGrossSalesPaise] = useState(0);

  // Status
  const status = 'active' as const;
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Primary row for pricing & storefront preview
  const primaryRow = sizeRows[activePreviewRowIdx] || sizeRows[0] || {
    id: 'fallback',
    label: 'Standard',
    sellingPrice: '100',
    wrongDefectivePrice: '95',
    mrp: '150',
    stock: '10',
    sku: 'ESK-ITEM-1',
  };

  const numSelling = Number(primaryRow.sellingPrice) || 0;
  const numCompare = Number(primaryRow.mrp) || 0;
  const totalStockAcrossSizes = useMemo(
    () => sizeRows.reduce((sum, r) => sum + (Number(r.stock) || 0), 0),
    [sizeRows]
  );

  // Notify parent of draft changes
  useEffect(() => {
    onDraftSaved?.({
      title,
      categoryId,
      sellingPrice: primaryRow.sellingPrice,
      stock: String(totalStockAcrossSizes),
      status,
    });
  }, [title, categoryId, primaryRow.sellingPrice, totalStockAcrossSizes, status, onDraftSaved]);

  // Load Categories on mount
  useEffect(() => {
    let active = true;
    api
      .categories()
      .then((data) => {
        if (!active) return;
        setCategories(data);
        if (data.length > 0 && !categoryId) {
          setCategoryId(data[0].categoryId);
          if (data[0].subcategories?.length > 0) {
            setSubcategoryId(data[0].subcategories[0].subcategoryId);
          }
        }
      })
      .catch((err) => {
        console.warn('Failed to load categories dynamically, using fallback', err);
      });
    return () => {
      active = false;
    };
  }, []);

  // Sync registered seller tax profile on mount (GSTIN vs Enrolment ID)
  useEffect(() => {
    let active = true;
    api
      .getSellerProfile()
      .then((res) => {
        if (!active || !res?.seller?.taxDetails) return;
        const td = res.seller.taxDetails;
        if (res.seller.supplierDetails?.shgName) {
          setBrand(res.seller.supplierDetails.shgName);
        }
        if (td.hasGst && td.gstin) {
          setTaxProfile('GST_REGISTERED');
          setRegisteredGstin(td.gstin);
          setChargeTax(true);
          setGstRate((prev) => (prev === 0 ? 5 : prev));
        } else {
          setTaxProfile('NON_GST_ENROLMENT');
          setRegisteredEnrolmentId(td.enrolmentId || 'ENR-MP-470661-0012');
          setChargeTax(false);
          setGstRate(0);
        }
      })
      .catch((err) => {
        console.warn('Could not auto-sync seller tax profile:', err);
      });
    api
      .sellerSettlements()
      .then((res) => {
        if (!active || !res) return;
        const fyGross = res.statutoryTaxLedger?.fyGrossSalesPaise ?? res.grossMonthlyPayoutPaise ?? 0;
        setFyGrossSalesPaise(fyGross);
        setAnnualSalesExceeds5Lakh(Boolean(res.statutoryTaxLedger?.exceeds5LakhThreshold || fyGross > 50_000_000));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Auto-generate standardized Master SKU, EAN-13 Barcode & Variant SKUs
  const handleRegenerateAllSkus = async (overrideTitle?: string, overrideCat?: string) => {
    const effectiveTitle = (overrideTitle ?? title).trim() || productType || 'Artisan Craft';
    const effectiveCat = overrideCat ?? categoryId;
    const nextMaster = buildClientMasterSku(effectiveCat, brand, effectiveTitle);
    const nextBarcode = buildClientBarcode(nextMaster);
    setSku(nextMaster);
    setBarcode(nextBarcode);
    setSizeRows((prev) =>
      prev.map((r, idx) => ({
        ...r,
        sku: buildClientVariantSku(nextMaster, r.label, idx),
      }))
    );
    try {
      const serverSkus = await api.generateProductSkusPreview({
        categoryId: effectiveCat,
        brandOrShg: brand,
        productName: effectiveTitle,
        variantLabels: sizeRows.map((r) => r.label),
      });
      if (serverSkus?.masterSku) {
        setSku(serverSkus.masterSku);
        if (serverSkus.barcode) setBarcode(serverSkus.barcode);
        setSizeRows((prev) =>
          prev.map((r, idx) => ({
            ...r,
            sku: serverSkus.variantSkus?.[idx]?.sku || buildClientVariantSku(serverSkus.masterSku, r.label, idx),
          }))
        );
      }
    } catch {
      /* client fallback already applied */
    }
    setSavedMessage(`✓ Standardized Master SKU (${nextMaster}) & ${sizeRows.length} Variant SKUs generated!`);
    setTimeout(() => setSavedMessage(''), 3000);
  };

  // Apply Master Catalog SKU / Barcode item
  const handleApplyMasterCatalogSku = (item: MasterCatalogProduct) => {
    setTitle(item.name);
    setDescription(item.description);
    setBrand(item.brand || brand);
    setSku(item.masterSku);
    setBarcode(item.barcode);
    setHSNCode(item.hsnCode);
    if (taxProfile === 'GST_REGISTERED') {
      setGstRate(item.productGstRate);
    }
    setImageUrls([item.imageUrl]);
    const retPrice = String(Math.max(5, Math.round(item.suggestedBasePrice * 0.96)));
    setSizeRows([
      {
        id: `mc-${Date.now()}`,
        label: 'Standard Pack',
        sellingPrice: String(item.suggestedBasePrice),
        wrongDefectivePrice: retPrice,
        mrp: String(item.printedUnitMrp),
        stock: '25',
        sku: `${item.masterSku}-STD`,
      },
    ]);
    setSavedMessage(`✓ Auto-filled SKU ${item.masterSku} (Barcode: ${item.barcode}, HSN: ${item.hsnCode})!`);
    setTimeout(() => setSavedMessage(''), 3500);
  };

  const activeCategory = useMemo(() => {
    return categories.find((c) => c.categoryId === categoryId);
  }, [categories, categoryId]);

  const subcategoryList = useMemo(() => {
    return activeCategory?.subcategories ?? [];
  }, [activeCategory]);

  // Detect if current product is Bangles / Jewellery
  const isJewelleryOrBangle = useMemo(() => {
    const combined = `${subcategoryId} ${productType} ${title}`.toLowerCase();
    return (
      dimensionType === 'BANGLE_JEWELLERY' ||
      subcategoryId === 'jewellery-accessories' ||
      /bangle|chudi|kada|kangan|jewel|necklace|earring|jhumka|ring|payal|anklet|mangalsutra/.test(combined)
    );
  }, [dimensionType, subcategoryId, productType, title]);

  // Dynamic Category-Specific Attribute Labels & Quick Presets (Meesho Style)
  const attrMeta = useMemo(() => {
    if (isJewelleryOrBangle) {
      return {
        groupTitle: 'Bangles & Jewellery Specifications (Meesho Jewellery Standard)',
        label1: 'Base Metal / Material',
        chips1: ['Silver-Plated Brass', 'Alloy & Metal', 'Glass / Lac (Laakh)', 'Gold-Plated Brass', 'Stainless Steel'],
        label2: 'Stone / Pearl / Work Type',
        chips2: ['Pearl & Multicolor AD Stone', 'Kundan & Meenakari', 'American Diamond (AD)', 'Oxidised Silver Work'],
        label3: 'Plating & Occasion',
        chips3: ['Rhodium Silver Plated · Festive & Bridal', 'Gold Plated · Wedding & Party Wear', 'Daily & Traditional Wear'],
        label4: 'Pack Contains (In the Box)',
        chips4: ['Pair of 2 Bangles (1 Pair)', 'Set of 4 Bangles', 'Set of 6 Bangles', 'Set of 12 Bangles (1 Dozen)'],
      };
    }
    if (categoryId === 'food-items' || dimensionType === 'WEIGHT_GRAMS') {
      return {
        groupTitle: 'Food, Pickle & Grocery Specifications',
        label1: 'Main Ingredients',
        chips1: ['Raw Mango, Mustard Oil & Whole Spices', 'Urad Dal, Black Pepper & Hing', '100% Natural Farm Ingredients'],
        label2: 'Food Preference & Purity',
        chips2: ['100% Vegetarian · Zero Preservatives', 'Homemade SHG Recipe · Chemical-Free', 'Sun-Dried & Hygienically Packed'],
        label3: 'Shelf Life / Best Before',
        chips3: ['6 Months Shelf Life', '12 Months Shelf Life', '3 Months Shelf Life'],
        label4: 'Container / Packaging Type',
        chips4: ['Leak-Proof Sealed Jar', 'Food-Grade Standee Zip Pouch', 'Air-Tight Hygiene Box'],
      };
    }
    if (categoryId === 'personal-care') {
      return {
        groupTitle: 'Herbal & Personal Care Specifications',
        label1: 'Key Herbal Ingredients',
        chips1: ['Multani Mitti, Neem & Aloe Vera', 'Cold-Pressed Coconut & Sesame Oil', 'Pure Rosewater & Turmeric'],
        label2: 'Formulation / Process',
        chips2: ['100% Handmade Cold-Process', 'Ayurvedic Herbal Blend · Paraben-Free', 'Organic & Sulfate-Free'],
        label3: 'Skin / Hair Type & Shelf Life',
        chips3: ['All Skin Types · 12 Months', 'Sensitive & Normal Skin · 18 Months', 'All Hair Types · 12 Months'],
        label4: 'Pack Contains',
        chips4: ['Eco-Friendly Butter Paper Box', 'Leak-Proof PET Bottle', 'Combo Value Pack'],
      };
    }
    if (categoryId === 'home-and-living') {
      return {
        groupTitle: 'Handicraft & Home Decor Specifications',
        label1: 'Primary Material',
        chips1: ['Natural Baked Terracotta Clay', 'Seasoned Bamboo & Cane', 'Bell Metal (Dhokra Brass)', 'Pure Cotton / Jute'],
        label2: 'Artisan Craft & Finish',
        chips2: ['Hand-Painted Bundeli Art', 'Natural Polished Finish', 'Traditional Handwoven'],
        label3: 'Ideal Usage / Occasion',
        chips3: ['Diwali, Pooja & Festive Decor', 'Living Room & Table Decor', 'Daily Household Utility'],
        label4: 'Box Contents & Care',
        chips4: ['Bubble-Wrapped Safe Box', 'Washable & Reusable', 'Fragile — Handle with Care'],
      };
    }
    return {
      groupTitle: 'Saree, Kurti & Apparel Specifications',
      label1: 'Fabric / Material',
      chips1: ['Authentic Chanderi Silk', '100% Pure Handloom Cotton', 'Mulmul Cotton', 'Rayon / Georgette'],
      label2: 'Pattern / Weave / Work',
      chips2: ['Handloom Zari Woven Border', 'Hand Block Printed', 'Traditional Embroidery', 'Solid Woven'],
      label3: 'Occasion',
      chips3: ['Festive & Wedding Wear', 'Daily & Office Wear', 'Party & Traditional Wear'],
      label4: 'Blouse Piece / Dupatta / Set Info',
      chips4: ['With 0.8m Unstitched Blouse Piece', 'Kurti with Pant & Dupatta Set', 'Single Stitched Kurta (No Bottom)'],
    };
  }, [isJewelleryOrBangle, categoryId, dimensionType]);

  // Apply Bangle & Jewellery preset
  const applyBangleJewelleryMode = () => {
    setCategoryId('womens-apparel-accessories');
    setSubcategoryId('jewellery-accessories');
    setProductType('Pearl & Stone Studded Bangles');
    setDimensionType('BANGLE_JEWELLERY');
    setWeight('150');
    setWeightUnit('g');
    setNetQuantity('2');
    setSizeRows([
      {
        id: 'bng-24',
        label: '2.4 (Medium)',
        sellingPrice: '200',
        wrongDefectivePrice: '190',
        mrp: '300',
        stock: '15',
        sku: 'ESK-BNG-24',
      },
      {
        id: 'bng-26',
        label: '2.6 (Large)',
        sellingPrice: '200',
        wrongDefectivePrice: '190',
        mrp: '300',
        stock: '20',
        sku: 'ESK-BNG-26',
      },
      {
        id: 'bng-28',
        label: '2.8 (XL)',
        sellingPrice: '200',
        wrongDefectivePrice: '190',
        mrp: '300',
        stock: '12',
        sku: 'ESK-BNG-28',
      },
    ]);
    setAttrFabricOrMaterial('Silver-Plated Brass & Alloy');
    setAttrPatternOrType('Pearl & Multicolor AD Stone Studded');
    setAttrOccasionOrShelfLife('Rhodium Silver Plated · Festive & Bridal Wear');
    setAttrPackOrBlouseInfo('Pair of 2 Bangles (1 Pair)');
    setActivePreviewRowIdx(0);
  };

  // Switch Measurement Mode in Step 2 and reset default rows cleanly so stale sizes never mix
  const handleSwitchDimensionType = (newType: VariantDimensionType) => {
    setDimensionType(newType);
    const currentPrice = sizeRows[0]?.sellingPrice || '200';
    const currentMrp = sizeRows[0]?.mrp || '300';
    const currentStock = sizeRows[0]?.stock || '20';
    const retPrice = String(Math.max(5, Math.round((Number(currentPrice) || 200) * 0.96)));

    if (newType === 'BANGLE_JEWELLERY') {
      setSizeRows([
        { id: 'bng-24', label: '2.4 (Medium)', sellingPrice: currentPrice, wrongDefectivePrice: retPrice, mrp: currentMrp, stock: currentStock, sku: 'ESK-BNG-24' },
        { id: 'bng-26', label: '2.6 (Large)', sellingPrice: currentPrice, wrongDefectivePrice: retPrice, mrp: currentMrp, stock: currentStock, sku: 'ESK-BNG-26' },
        { id: 'bng-28', label: '2.8 (XL)', sellingPrice: currentPrice, wrongDefectivePrice: retPrice, mrp: currentMrp, stock: currentStock, sku: 'ESK-BNG-28' },
      ]);
      setAttrFabricOrMaterial('Silver-Plated Brass & Alloy');
      setAttrPatternOrType('Pearl & Multicolor AD Stone Studded');
      setAttrOccasionOrShelfLife('Rhodium Plated · Festive & Party Wear');
      setAttrPackOrBlouseInfo('Pair of 2 Bangles (1 Pair)');
    } else if (newType === 'WEIGHT_GRAMS') {
      setSizeRows([
        { id: 'wt-250g', label: '250g', sellingPrice: '90', wrongDefectivePrice: '85', mrp: '120', stock: '30', sku: 'ESK-WT-250G' },
        { id: 'wt-500g', label: '500g', sellingPrice: '160', wrongDefectivePrice: '152', mrp: '210', stock: '25', sku: 'ESK-WT-500G' },
      ]);
    } else if (newType === 'PACK_COUNT') {
      setSizeRows([
        { id: 'pk-1', label: 'Single (1 Pc)', sellingPrice: currentPrice, wrongDefectivePrice: retPrice, mrp: currentMrp, stock: currentStock, sku: 'ESK-PK-1' },
        { id: 'pk-2', label: 'Pack of 2', sellingPrice: String(Math.round(Number(currentPrice) * 1.85)), wrongDefectivePrice: String(Math.round(Number(currentPrice) * 1.75)), mrp: String(Number(currentMrp) * 2), stock: currentStock, sku: 'ESK-PK-2' },
      ]);
    } else if (newType === 'VOLUME_ML') {
      setSizeRows([
        { id: 'vol-100', label: '100 ml', sellingPrice: '95', wrongDefectivePrice: '90', mrp: '130', stock: '30', sku: 'ESK-VOL-100ML' },
        { id: 'vol-250', label: '250 ml', sellingPrice: '199', wrongDefectivePrice: '190', mrp: '260', stock: '20', sku: 'ESK-VOL-250ML' },
      ]);
    } else {
      setSizeRows([
        { id: 'sz-free', label: 'Free Size', sellingPrice: currentPrice, wrongDefectivePrice: retPrice, mrp: currentMrp, stock: currentStock, sku: 'ESK-SZ-FREE' },
      ]);
    }
    setActivePreviewRowIdx(0);
  };

  // Automatically switch Dimension Type & Default Attributes when category changes
  const handleCategoryChange = (newCatId: string) => {
    if (newCatId === 'bangles-jewellery-special') {
      applyBangleJewelleryMode();
      return;
    }
    setCategoryId(newCatId);
    const cat = categories.find((c) => c.categoryId === newCatId);
    if (cat && cat.subcategories.length > 0) {
      setSubcategoryId(cat.subcategories[0].subcategoryId);
      setProductType(cat.subcategories[0].subcategoryName);
    }

    if (newCatId === 'food-items') {
      setDimensionType('WEIGHT_GRAMS');
      setSizeRows([
        {
          id: 'wt-250g',
          label: '250g',
          sellingPrice: '90',
          wrongDefectivePrice: '85',
          mrp: '120',
          stock: '30',
          sku: 'ESK-FOOD-250G',
        },
        {
          id: 'wt-500g',
          label: '500g',
          sellingPrice: '160',
          wrongDefectivePrice: '152',
          mrp: '210',
          stock: '25',
          sku: 'ESK-FOOD-500G',
        },
      ]);
      setAttrFabricOrMaterial('Homemade Traditional Recipe');
      setAttrPatternOrType('100% Vegetarian · No Preservatives');
      setAttrOccasionOrShelfLife('6 Months Shelf Life');
      setAttrPackOrBlouseInfo('Food-Grade Sealed Jar / Pouch');
      setActivePreviewRowIdx(0);
    } else if (newCatId === 'home-and-living') {
      setDimensionType('PACK_COUNT');
      setSizeRows([
        {
          id: 'pk-6',
          label: 'Pack of 6',
          sellingPrice: '85',
          wrongDefectivePrice: '80',
          mrp: '120',
          stock: '40',
          sku: 'ESK-HOME-PK6',
        },
        {
          id: 'pk-12',
          label: 'Pack of 12',
          sellingPrice: '150',
          wrongDefectivePrice: '142',
          mrp: '220',
          stock: '30',
          sku: 'ESK-HOME-PK12',
        },
      ]);
      setAttrFabricOrMaterial('Natural Terracotta Clay / Bamboo');
      setAttrPatternOrType('Hand-Painted Artisan Finish');
      setAttrOccasionOrShelfLife('Festive & Home Decor');
      setAttrPackOrBlouseInfo('Bubble-Wrapped Safe Box');
      setActivePreviewRowIdx(0);
    } else if (newCatId === 'personal-care') {
      setDimensionType('WEIGHT_GRAMS');
      setSizeRows([
        {
          id: 'pc-100g',
          label: '100g',
          sellingPrice: '95',
          wrongDefectivePrice: '90',
          mrp: '130',
          stock: '35',
          sku: 'ESK-HERB-100G',
        },
        {
          id: 'pc-200g',
          label: '200g',
          sellingPrice: '175',
          wrongDefectivePrice: '165',
          mrp: '240',
          stock: '20',
          sku: 'ESK-HERB-200G',
        },
      ]);
      setAttrFabricOrMaterial('Multani Mitti, Neem & Aloe Vera');
      setAttrPatternOrType('100% Herbal Cold-Processed');
      setAttrOccasionOrShelfLife('All Skin & Hair Types');
      setAttrPackOrBlouseInfo('12 Months Shelf Life');
      setActivePreviewRowIdx(0);
    } else {
      setDimensionType('APPAREL_SIZE');
      setSizeRows([
        {
          id: 'sz-free',
          label: 'Free Size',
          sellingPrice: '1499',
          wrongDefectivePrice: '1449',
          mrp: '1999',
          stock: '20',
          sku: 'ESK-APP-FREE',
        },
      ]);
      setAttrFabricOrMaterial('Chanderi Silk / Pure Cotton');
      setAttrPatternOrType('Handloom Zari Woven');
      setAttrOccasionOrShelfLife('Festive & Party Wear');
      setAttrPackOrBlouseInfo('With Unstitched Blouse Piece');
      setActivePreviewRowIdx(0);
    }
  };

  // Toggle a size / weight chip in the Meesho table
  const toggleSizeOption = (optionLabel: string) => {
    const exists = sizeRows.some((r) => r.label.toLowerCase() === optionLabel.toLowerCase());
    if (exists) {
      if (sizeRows.length <= 1) {
        setErrorMessage('At least 1 size or pack quantity must remain selected.');
        setTimeout(() => setErrorMessage(''), 3000);
        return;
      }
      setSizeRows((prev) => prev.filter((r) => r.label.toLowerCase() !== optionLabel.toLowerCase()));
      setActivePreviewRowIdx(0);
    } else {
      const basePriceNum = Number(sizeRows[0]?.sellingPrice) || 150;
      const baseMrpNum = Number(sizeRows[0]?.mrp) || 220;
      let smartPrice = basePriceNum;
      let smartMrp = baseMrpNum;
      const lower = optionLabel.toLowerCase();
      if (lower === '50g' || lower === '50 ml') {
        smartPrice = 30;
        smartMrp = 40;
      } else if (lower === '100g' || lower === '100 ml') {
        smartPrice = 50;
        smartMrp = 70;
      } else if (lower === '200g' || lower === '200 ml') {
        smartPrice = 80;
        smartMrp = 110;
      } else if (lower === '250g' || lower === '250 ml') {
        smartPrice = 95;
        smartMrp = 130;
      } else if (lower === '500g' || lower === '500 ml') {
        smartPrice = 175;
        smartMrp = 230;
      } else if (lower === '1 kg' || lower === '1 litre') {
        smartPrice = 320;
        smartMrp = 420;
      } else if (lower === '2 kg') {
        smartPrice = 600;
        smartMrp = 780;
      } else if (lower === '5 kg') {
        smartPrice = 1400;
        smartMrp = 1800;
      }
      const baseStock = sizeRows[0]?.stock || '20';
      const cleanCode = optionLabel.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'VAR';
      const newRow: MeeshoSizeRow = {
        id: `row-${crypto.randomUUID()}`,
        label: optionLabel,
        sellingPrice: String(smartPrice),
        wrongDefectivePrice: String(Math.max(5, Math.round(smartPrice * 0.96))),
        mrp: String(smartMrp),
        stock: baseStock,
        sku: `ESK-${cleanCode}-${sizeRows.length + 1}`,
      };
      setSizeRows((prev) => [...prev, newRow]);
    }
  };

  const handleAddCustomSize = () => {
    const trimmed = customSizeInput.trim();
    if (!trimmed) return;
    if (!sizeRows.some((r) => r.label.toLowerCase() === trimmed.toLowerCase())) {
      toggleSizeOption(trimmed);
    }
    setCustomSizeInput('');
  };

  // Meesho "Apply to All Selected Sizes" 1-Click handler
  const handleApplyBulkToAllSizes = () => {
    setSizeRows((prev) =>
      prev.map((row) => {
        const nextPrice = bulkPrice.trim() ? bulkPrice.trim() : row.sellingPrice;
        return {
          ...row,
          sellingPrice: nextPrice,
          wrongDefectivePrice: String(Math.max(5, Math.round((Number(nextPrice) || 0) * 0.96))),
          mrp: bulkMrp.trim() ? bulkMrp.trim() : row.mrp,
          stock: bulkStock.trim() ? bulkStock.trim() : row.stock,
        };
      })
    );
    setSavedMessage('✓ Applied price, MRP & stock across all selected sizes!');
    setTimeout(() => setSavedMessage(''), 3000);
  };

  const updateSizeRow = (idx: number, field: keyof MeeshoSizeRow, value: string) => {
    setSizeRows((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const updated = { ...row, [field]: value };
        if (field === 'sellingPrice') {
          const num = Number(value) || 0;
          updated.wrongDefectivePrice = String(Math.max(5, Math.round(num * 0.96)));
        }
        return updated;
      })
    );
  };

  // Helper to compute per-row financials (MOQ & Net Bank Payout)
  const computeRowFinancials = (row: MeeshoSizeRow) => {
    const p = Number(row.sellingPrice) || 0;
    const m = Number(row.mrp) || p;
    return calculateProductFinancials({
      sellerBasePrice: p,
      printedUnitMrp: m > 0 ? m : p,
      category: categoryId,
      productGstRate: chargeTax && taxProfile === 'GST_REGISTERED' ? gstRate : 0,
      sellerTaxProfile: taxProfile,
      minOrderQuantity: 1,
      isInterState: false,
      sellerAnnualSalesExceeds5Lakh: annualSalesExceeds5Lakh,
    });
  };

  const financials = useMemo(() => computeRowFinancials(primaryRow), [
    primaryRow.sellingPrice,
    primaryRow.mrp,
    categoryId,
    chargeTax,
    taxProfile,
    gstRate,
  ]);

  const deliveryFeeRupees = 15;
  const customerTotalBill = financials.packSellingPrice + deliveryFeeRupees;
  const discountPercent = useMemo(() => {
    if (numCompare > numSelling && numSelling > 0) {
      return Math.round(((numCompare - numSelling) / numCompare) * 100);
    }
    return 0;
  }, [numSelling, numCompare]);

  // Image Upload Handlers
  const handleAddImageUrl = () => {
    const trimmed = imageUrlInput.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith('https://') && !trimmed.startsWith('data:image/')) {
      setErrorMessage('Please enter a valid HTTPS image URL.');
      return;
    }
    if (imageUrls.length >= 8) {
      setErrorMessage('Maximum 8 product photos allowed.');
      return;
    }
    setImageUrls([...imageUrls, trimmed]);
    setImageUrlInput('');
    setErrorMessage('');
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    setErrorMessage('');
    try {
      const res = await api.uploadProductImage(file);
      if (res.imageUrl) {
        setImageUrls((prev) => [...prev, res.imageUrl]);
      }
    } catch {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setImageUrls((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Auto-write description from selected attributes & sizes
  const handleAutoWriteDescription = () => {
    const sizesText = sizeRows.map((r) => r.label).join(', ');
    const dimLabel = DIMENSION_PRESETS[dimensionType].attributeKey.replace('_', ' ');
    const generated = [
      `Authentic ${title || productType} handcrafted by ${brand} in Damoh, Madhya Pradesh.`,
      `Crafted with ${attrFabricOrMaterial} featuring ${attrPatternOrType.toLowerCase()}.`,
      `Available in ${dimLabel} options (${sizesText}) — ideal for ${attrOccasionOrShelfLife.toLowerCase()}.`,
      `Comes as ${attrPackOrBlouseInfo} with fast ₹15 local doorstep delivery across Damoh.`,
    ].join(' ');
    setDescription(generated);
    setSavedMessage('✓ Auto-generated clean product description!');
    setTimeout(() => setSavedMessage(''), 3000);
  };

  // 1-Click Template Application
  const applyTemplate = (tmpl: DamohProductTemplate) => {
    setTitle(tmpl.name);
    setDescription(tmpl.description);
    setCategoryId(tmpl.categoryId);
    setSubcategoryId(tmpl.subcategoryId);
    setProductType(tmpl.productType);
    setWeight('500');
    setWeightUnit('g');
    const mrpVal = Math.round(tmpl.defaultPrice * 1.3);
    const skuCode = tmpl.id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);

    if (tmpl.categoryId === 'womens-apparel-accessories') {
      setDimensionType('APPAREL_SIZE');
      setImageUrls(['https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80']);
      setSizeRows([
        {
          id: 'sar-free',
          label: 'Free Size',
          sellingPrice: String(tmpl.defaultPrice),
          wrongDefectivePrice: String(Math.round(tmpl.defaultPrice * 0.96)),
          mrp: String(mrpVal),
          stock: String(tmpl.defaultStock || 15),
          sku: `${skuCode}-FREE`,
        },
      ]);
      setAttrFabricOrMaterial('Authentic Chanderi Silk');
      setAttrPatternOrType('Handloom Zari Border');
      setAttrOccasionOrShelfLife('Festive & Wedding Wear');
      setAttrPackOrBlouseInfo('With 0.8m Unstitched Blouse Piece');
    } else if (tmpl.categoryId === 'home-and-living') {
      setDimensionType('PACK_COUNT');
      setImageUrls(['https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&w=800&q=80']);
      setSizeRows([
        {
          id: 'diya-pk6',
          label: 'Pack of 6',
          sellingPrice: '85',
          wrongDefectivePrice: '80',
          mrp: '120',
          stock: '40',
          sku: `${skuCode}-PK6`,
        },
        {
          id: 'diya-pk12',
          label: 'Pack of 12',
          sellingPrice: String(tmpl.defaultPrice),
          wrongDefectivePrice: String(Math.round(tmpl.defaultPrice * 0.96)),
          mrp: String(mrpVal),
          stock: String(tmpl.defaultStock || 30),
          sku: `${skuCode}-PK12`,
        },
      ]);
      setAttrFabricOrMaterial('Natural Baked Terracotta Clay');
      setAttrPatternOrType('Hand-Painted Bundeli Art');
      setAttrOccasionOrShelfLife('Diwali & Daily Pooja');
      setAttrPackOrBlouseInfo('Safe Cushion Box Pack');
    } else if (tmpl.categoryId === 'personal-care') {
      setDimensionType('WEIGHT_GRAMS');
      setImageUrls(['https://images.unsplash.com/photo-1607006311820-d858c345a0b7?auto=format&fit=crop&w=800&q=80']);
      setSizeRows([
        {
          id: 'soap-100g',
          label: '100g',
          sellingPrice: String(tmpl.defaultPrice),
          wrongDefectivePrice: String(Math.round(tmpl.defaultPrice * 0.96)),
          mrp: String(mrpVal),
          stock: String(tmpl.defaultStock || 35),
          sku: `${skuCode}-100G`,
        },
        {
          id: 'soap-300g',
          label: '300g (Pack of 3)',
          sellingPrice: String(tmpl.defaultPrice * 3 - 20),
          wrongDefectivePrice: String(Math.round((tmpl.defaultPrice * 3 - 20) * 0.96)),
          mrp: String(mrpVal * 3),
          stock: '20',
          sku: `${skuCode}-300G`,
        },
      ]);
      setAttrFabricOrMaterial('Multani Mitti, Neem & Coconut Oil');
      setAttrPatternOrType('100% Handmade Cold-Process');
      setAttrOccasionOrShelfLife('All Skin Types · 12M Shelf Life');
      setAttrPackOrBlouseInfo('Eco-Friendly Butter Paper Box');
    } else {
      setDimensionType('WEIGHT_GRAMS');
      setImageUrls(['https://images.unsplash.com/photo-1589301760014-d929f3979dbc?auto=format&fit=crop&w=800&q=80']);
      setSizeRows([
        {
          id: 'fd-250g',
          label: '250g',
          sellingPrice: String(Math.max(45, Math.round(tmpl.defaultPrice * 0.55))),
          wrongDefectivePrice: String(Math.max(42, Math.round(tmpl.defaultPrice * 0.52))),
          mrp: String(Math.round(mrpVal * 0.55)),
          stock: '35',
          sku: `${skuCode}-250G`,
        },
        {
          id: 'fd-500g',
          label: '500g',
          sellingPrice: String(tmpl.defaultPrice),
          wrongDefectivePrice: String(Math.round(tmpl.defaultPrice * 0.96)),
          mrp: String(mrpVal),
          stock: String(tmpl.defaultStock || 25),
          sku: `${skuCode}-500G`,
        },
        {
          id: 'fd-1kg',
          label: '1 kg',
          sellingPrice: String(tmpl.defaultPrice * 2 - 25),
          wrongDefectivePrice: String(Math.round((tmpl.defaultPrice * 2 - 25) * 0.96)),
          mrp: String(mrpVal * 2),
          stock: '15',
          sku: `${skuCode}-1KG`,
        },
      ]);
      setAttrFabricOrMaterial('Farm-Fresh Mango, Mustard Oil & Spices');
      setAttrPatternOrType('100% Vegetarian · Zero Preservatives');
      setAttrOccasionOrShelfLife('12 Months Shelf Life');
      setAttrPackOrBlouseInfo('Leak-Proof Sealed Jar');
    }

    setActivePreviewRowIdx(0);
    setSavedMessage(`✓ Loaded Meesho-style template: ${tmpl.shortLabel}`);
    setTimeout(() => setSavedMessage(''), 3500);
  };

  // Submit Handler
  const handleSubmit = async (publishImmediately: boolean) => {
    setErrorMessage('');
    setSavedMessage('');

    if (!title.trim()) {
      setErrorMessage(
        lang === 'hi'
          ? 'कृपया उत्पाद का नाम दर्ज करें।'
          : 'Please enter a Product Name / Title in Step 3.'
      );
      return;
    }
    if (sizeRows.length === 0) {
      setErrorMessage('Please select at least one Size, Weight, or Pack option in Step 2.');
      return;
    }

    for (const row of sizeRows) {
      const rowPrice = Number(row.sellingPrice) || 0;
      const rowMrp = Number(row.mrp) || 0;
      if (rowPrice < 5) {
        setErrorMessage(
          `Size "${row.label}": Minimum unit selling price is ₹5. Products below ₹5 are not eligible.`
        );
        return;
      }
      if (rowMrp > 0 && rowPrice > rowMrp) {
        setErrorMessage(
          `Size "${row.label}": Selling Price (₹${rowPrice}) cannot exceed Printed MRP (₹${rowMrp}).`
        );
        return;
      }
    }

    if (taxProfile === 'GST_REGISTERED' && !hsnCode.trim()) {
      setErrorMessage('HSN Code is mandatory for GST-registered sellers.');
      return;
    }

    setSaving(true);
    try {
      const dimKey = DIMENSION_PRESETS[dimensionType].attributeKey;
      const cleanDimTitle = dimKey.replace('_', ' ');
      const sizesSummary = sizeRows
        .map((r) => `${r.label} (₹${r.sellingPrice})`)
        .join(', ');

      // Strip any previously auto-generated bullet lines from description to prevent duplicate specs
      const cleanNarrative = (description.trim() || `${title.trim()} handcrafted by ${brand} in Damoh, Madhya Pradesh.`)
        .split('\n')
        .filter((line) => !line.trim().startsWith('•') && !line.trim().startsWith('Product Specifications:'))
        .join(' ')
        .trim();

      const fullDescription = [
        cleanNarrative,
        `\nProduct Specifications:`,
        `• Brand / SHG: ${brand}`,
        `• Available ${cleanDimTitle}: ${sizesSummary}`,
        `• ${attrMeta.label1}: ${attrFabricOrMaterial}`,
        `• ${attrMeta.label2}: ${attrPatternOrType}`,
        `• ${attrMeta.label3}: ${attrOccasionOrShelfLife}`,
        `• ${attrMeta.label4}: ${attrPackOrBlouseInfo}`,
        `• Net Quantity (N): ${netQuantity} | Package Weight: ${weight}${weightUnit}`,
      ]
        .filter(Boolean)
        .join('\n');

      const firstRow = sizeRows[0];
      const pricePaise = Math.round((Number(firstRow.sellingPrice) || 100) * 100);
      const printedUnitMrpPaise =
        Number(firstRow.mrp) > 0 ? Math.round(Number(firstRow.mrp) * 100) : undefined;
      const basePricePaise = Math.round(pricePaise * 0.9);

      const variantsPayload = sizeRows.map((r) => ({
        sku: r.sku.trim() || undefined,
        stock: Number(r.stock) || 0,
        attributes: {
          [dimKey]: r.label,
          SellingPrice: String(r.sellingPrice),
          MRP: String(r.mrp || r.sellingPrice),
        },
      }));

      await api.createSellerProduct({
        name: title.trim(),
        description: fullDescription,
        categoryId,
        subcategoryId,
        productType: productType.trim() || 'Handcrafted',
        pricePaise,
        basePricePaise,
        printedUnitMrpPaise,
        imageUrls:
          imageUrls.length > 0
            ? imageUrls
            : [
                'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80',
              ],
        stock: variantsPayload.length > 0 ? 0 : Number(firstRow.stock) || 0,
        lowStockThreshold: Number(lowStockThreshold) || 5,
        variants: variantsPayload,
        masterSku: sku.trim() || undefined,
        barcode: barcode.trim() || undefined,
        hsnCode: hsnCode.trim() || undefined,
        productGstRate: chargeTax && taxProfile === 'GST_REGISTERED' ? gstRate : 0,
        minOrderQuantity: financials.minOrderQuantity,
        isActive: publishImmediately && status === 'active',
      });

      setSavedMessage(
        publishImmediately
          ? '🎉 Catalog submitted & published! All size/weight variants are now live.'
          : '✓ Catalog saved as draft.'
      );
      setTimeout(() => {
        onSubmitted();
      }, 900);
    } catch (err) {
      setErrorMessage(displayError(err));
    } finally {
      setSaving(false);
    }
  };

  const activePreset = DIMENSION_PRESETS[dimensionType];

  return (
    <div className="min-h-screen bg-[#F6F7FB] text-slate-900 pb-24">
      {/* ===================================================================== */}
      {/* TOP MEESHO-STYLE STICKY ACTION BAR                                    */}
      {/* ===================================================================== */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-8 py-3 shadow-xs">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{lang === 'hi' ? 'वापस जाएं' : 'Back to Products'}</span>
            </button>
            <div className="h-4 w-[1px] bg-slate-200 hidden sm:block" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-black tracking-tight text-slate-900">
                  {lang === 'hi' ? 'नया कैटलॉग जोड़ें (Meesho स्टाइल)' : 'Add Single Catalog'}
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider bg-purple-100 text-purple-900 rounded-full border border-purple-200">
                  Size · Weight · Pack Matrix
                </span>
              </div>
              <p className="text-[11px] text-slate-500 hidden sm:block">
                3 Simple Steps: Pick Category & Photos → Tick Sizes/Weights & Enter Prices → Add Product Details
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Languages className="w-3.5 h-3.5 text-slate-500" />
              <span>{lang === 'en' ? 'हिंदी' : 'English'}</span>
            </button>

            {/* Quick Demo Fill */}
            <div className="relative group">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-200 bg-purple-50 text-xs font-bold text-purple-800 hover:bg-purple-100 transition-all"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span>{lang === 'hi' ? 'उदाहरण भरें' : '1-Tap Sample Product'}</span>
                <ChevronDown className="w-3 h-3 text-purple-600" />
              </button>
              <div className="absolute right-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-xl p-1.5 hidden group-hover:block hover:block z-40">
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Try Ready Catalogs (with Sizes/Weights):
                </div>
                {DAMOH_PRODUCT_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => applyTemplate(tmpl)}
                    className="w-full text-left px-2.5 py-2 rounded-lg text-xs font-semibold text-slate-800 hover:bg-purple-50 hover:text-purple-900 flex items-center justify-between"
                  >
                    <span>{tmpl.shortLabel}</span>
                    <span className="text-[11px] font-bold text-purple-700">₹{tmpl.defaultPrice}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleSubmit(false)}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              {lang === 'hi' ? 'ड्राफ्ट सहेजें' : 'Save Draft'}
            </button>

            <button
              type="button"
              onClick={() => handleSubmit(true)}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#3C1E70] hover:bg-[#2c1554] text-white text-xs font-extrabold shadow-sm transition-all disabled:opacity-50 cursor-pointer"
            >
              {saving ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5 text-[#A3E635]" />
              )}
              <span>
                {saving
                  ? 'Submitting…'
                  : lang === 'hi'
                  ? 'कैटलॉग प्रकाशित करें'
                  : 'Submit Catalog'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* TOAST BANNERS */}
      {savedMessage && (
        <div className="max-w-7xl mx-auto px-4 sm:px-8 mt-4">
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{savedMessage}</span>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="max-w-7xl mx-auto px-4 sm:px-8 mt-4">
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-xs font-bold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MAIN 2-COLUMN WORKSPACE                                               */}
      {/* ===================================================================== */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 mt-5">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT 8 COLUMNS: 3 SIMPLE MEESHO STEPS */}
          <div className="lg:col-span-8 space-y-6">
            {/* =============================================================== */}
            {/* STEP 1: SELECT CATEGORY & UPLOAD PRODUCT PHOTOS                 */}
            {/* =============================================================== */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-2xs space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#3C1E70] text-white text-xs font-black flex items-center justify-center">
                    1
                  </span>
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-900">
                      {lang === 'hi'
                        ? 'श्रेणी चुनें और उत्पाद की फोटो अपलोड करें'
                        : 'Select Category & Upload Product Photos'}
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Choosing a category automatically sets up the right Size, Weight, or Pack options below.
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-md border border-purple-200">
                  Step 1 of 3
                </span>
              </div>

              {/* 1-Tap Visual Category Selector Pills */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-2">
                  {lang === 'hi' ? 'आप क्या बेच रहे हैं? (मुख्य श्रेणी चुनें) *' : 'What are you selling? (Choose Category) *'}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {[
                    {
                      id: 'womens-apparel-accessories',
                      label: '👗 Sarees, Kurtis & Apparel',
                      sub: 'Sizes: Free Size, S, M, L, XL, XXL',
                    },
                    {
                      id: 'bangles-jewellery-special',
                      label: '💍 Bangles, Chudi & Jewellery',
                      sub: 'Bangle Sizes: 2.2, 2.4, 2.6, 2.8, Pair/Set',
                    },
                    {
                      id: 'food-items',
                      label: '🫙 Pickles, Papad, Snacks & Grocery',
                      sub: 'Weights: 100g, 250g, 500g, 1 kg',
                    },
                    {
                      id: 'home-and-living',
                      label: '🪔 Handicrafts, Diyas & Home Decor',
                      sub: 'Packs: Single, Pack of 2, 6, 12',
                    },
                    {
                      id: 'personal-care',
                      label: '🌿 Herbal Soaps, Oils & Beauty',
                      sub: 'Weights/Volumes: 50g, 100g, 200ml',
                    },
                    {
                      id: 'mens-apparel-accessories',
                      label: '👔 Men’s Kurta, Shirts & Wear',
                      sub: 'Sizes: S, M, L, XL, XXL',
                    },
                  ].map((catPill) => {
                    const active =
                      catPill.id === 'bangles-jewellery-special'
                        ? isJewelleryOrBangle
                        : categoryId === catPill.id && !isJewelleryOrBangle;
                    return (
                      <button
                        key={catPill.id}
                        type="button"
                        onClick={() => handleCategoryChange(catPill.id)}
                        className={`p-3 rounded-xl border-2 text-left transition-all cursor-pointer ${
                          active
                            ? 'border-[#3C1E70] bg-purple-50/60 shadow-2xs'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="text-xs font-extrabold text-slate-900">{catPill.label}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{catPill.sub}</div>
                      </button>
                    );
                  })}
                </div>

                {/* Subcategory & Specific Product Type */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-100">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Subcategory <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={subcategoryId}
                      onChange={(e) => {
                        const nextSub = e.target.value;
                        setSubcategoryId(nextSub);
                        const sub = subcategoryList.find((s) => s.subcategoryId === nextSub);
                        if (sub) setProductType(sub.subcategoryName);
                        if (nextSub === 'jewellery-accessories') {
                          applyBangleJewelleryMode();
                        }
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-900 bg-white"
                    >
                      {subcategoryList.map((s) => (
                        <option key={s.subcategoryId} value={s.subcategoryId}>
                          {s.subcategoryName}
                        </option>
                      ))}
                      {subcategoryList.length === 0 && (
                        <option value={subcategoryId}>{subcategoryId || 'General'}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Product Type Name (shown on tag)
                    </label>
                    <input
                      type="text"
                      value={productType}
                      onChange={(e) => setProductType(e.target.value)}
                      placeholder="e.g. Chanderi Silk Saree, Homemade Mango Pickle, Terracotta Diya"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-900"
                    />
                  </div>
                </div>
              </div>

              {/* Meesho-Style Product Photo Slots */}
              <div className="pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-800">
                    {lang === 'hi'
                      ? 'उत्पाद की फोटो (पहली फोटो मुख्य कवर होगी) *'
                      : 'Product Photos (Clear front photo gets 3x more orders) *'}
                  </label>
                  <span className="text-[11px] font-bold text-slate-500">
                    {imageUrls.length} / 8 Photos Uploaded
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {imageUrls.map((url, idx) => (
                    <div
                      key={idx}
                      className="relative group aspect-square rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-50"
                    >
                      <img
                        src={url}
                        alt={`Product ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-[#3C1E70] text-white text-[10px] font-bold">
                        {idx === 0 ? '★ Main Cover' : `Photo ${idx + 1}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => setImageUrls(imageUrls.filter((_, i) => i !== idx))}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-rose-600 text-white opacity-90 hover:opacity-100 shadow-xs"
                        title="Remove Photo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {imageUrls.length < 8 && (
                    <label className="aspect-square rounded-xl border-2 border-dashed border-purple-300 bg-purple-50/40 hover:bg-purple-50 flex flex-col items-center justify-center p-3 text-center cursor-pointer transition-all">
                      <UploadCloud className="w-6 h-6 text-purple-700 mb-1" />
                      <span className="text-xs font-bold text-purple-950">
                        {uploadingImage ? 'Uploading…' : '+ Add Photo'}
                      </span>
                      <span className="text-[10px] text-slate-500 mt-0.5">
                        Front, Back, or Pack Label
                      </span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                <div className="flex gap-2 mt-3">
                  <input
                    type="url"
                    value={imageUrlInput}
                    onChange={(e) => setImageUrlInput(e.target.value)}
                    placeholder="Or paste an image link (https://...) here"
                    className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={handleAddImageUrl}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700"
                  >
                    Add Photo URL
                  </button>
                </div>
              </div>
            </div>

            {/* =============================================================== */}
            {/* STEP 2: MEESHO SIZE / WEIGHT / QUANTITY & PRICE-STOCK TABLE     */}
            {/* =============================================================== */}
            <div className="bg-white border-2 border-purple-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#3C1E70] text-white text-xs font-black flex items-center justify-center">
                    2
                  </span>
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-900">
                      {lang === 'hi'
                        ? 'साइज / वजन / पैक चुनें और कीमत व स्टॉक भरें'
                        : 'Select Sizes / Weights / Packs & Fill Price + Stock Table'}
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Just like Meesho: Tick all sizes or weights you sell and enter the price & stock for each row.
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-md border border-purple-200">
                  Step 2 of 3 · {sizeRows.length} Variant{sizeRows.length === 1 ? '' : 's'} Active
                </span>
              </div>

              {/* Dimension Type Switcher (Size vs Weight vs Pack Count vs Volume) */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-2">
                  How is this product measured or sold?
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {(
                    [
                      { key: 'APPAREL_SIZE', icon: Tag, label: 'Clothing Size (S, M, L, Free)' },
                      { key: 'BANGLE_JEWELLERY', icon: Sparkles, label: 'Bangle / Jewellery (2.2, 2.4, 2.6, 2.8)' },
                      { key: 'WEIGHT_GRAMS', icon: Scale, label: 'Weight (100g, 250g, 500g, 1kg)' },
                      { key: 'PACK_COUNT', icon: Layers, label: 'Pack / Pieces (Pack of 2, 6, 12)' },
                      { key: 'VOLUME_ML', icon: Package, label: 'Liquid Volume (100ml, 500ml, 1L)' },
                    ] as const
                  ).map((item) => {
                    const Icon = item.icon;
                    const isSelected = dimensionType === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => handleSwitchDimensionType(item.key)}
                        className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                          isSelected
                            ? 'border-[#3C1E70] bg-[#3C1E70] text-white font-bold shadow-2xs'
                            : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="text-[11px] leading-tight">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 1-Click Size / Weight / Pack Chips (Meesho Multi-Select) */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-extrabold text-slate-900">
                      {lang === 'hi' ? activePreset.titleHi : activePreset.titleEn}
                    </div>
                    <div className="text-[11px] text-slate-500">{activePreset.subtitleEn}</div>
                  </div>
                </div>

                {/* Preset Checkable Pills */}
                <div className="flex flex-wrap gap-2">
                  {activePreset.options.map((opt) => {
                    const isChecked = sizeRows.some(
                      (r) => r.label.toLowerCase() === opt.toLowerCase()
                    );
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => toggleSizeOption(opt)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-extrabold border-2 flex items-center gap-1.5 transition-all cursor-pointer ${
                          isChecked
                            ? 'border-[#3C1E70] bg-purple-100/80 text-[#3C1E70] shadow-2xs'
                            : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                        }`}
                      >
                        <span
                          className={`w-4 h-4 rounded flex items-center justify-center text-[10px] ${
                            isChecked
                              ? 'bg-[#3C1E70] text-white'
                              : 'border border-slate-300 bg-slate-50'
                          }`}
                        >
                          {isChecked ? '✓' : ''}
                        </span>
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Custom Size / Weight Input */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/80">
                  <span className="text-[11px] font-bold text-slate-600">
                    Need a custom size, weight, or combo?
                  </span>
                  <input
                    type="text"
                    value={customSizeInput}
                    onChange={(e) => setCustomSizeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomSize();
                      }
                    }}
                    placeholder="e.g. 350g Jar, 42 Inch, Pack of 3, Family Pack"
                    className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomSize}
                    className="px-3 py-1.5 rounded-lg bg-[#3C1E70] text-white text-xs font-bold hover:bg-[#2c1554] flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Option</span>
                  </button>
                </div>
              </div>

              {/* Meesho "Copy Price, MRP & Stock to All Sizes" Bar (shows when >1 size is ticked) */}
              {sizeRows.length > 1 && (
                <div className="p-3 rounded-xl bg-purple-50/70 border border-purple-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-purple-950">
                    <Copy className="w-3.5 h-3.5 text-purple-700" />
                    <span>Same price for all sizes? Quick fill all rows:</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      placeholder="Price ₹"
                      value={bulkPrice}
                      onChange={(e) => setBulkPrice(e.target.value)}
                      className="w-24 px-2.5 py-1 rounded-lg border border-purple-300 bg-white text-xs font-bold"
                    />
                    <input
                      type="number"
                      placeholder="MRP ₹"
                      value={bulkMrp}
                      onChange={(e) => setBulkMrp(e.target.value)}
                      className="w-24 px-2.5 py-1 rounded-lg border border-purple-300 bg-white text-xs font-bold"
                    />
                    <input
                      type="number"
                      placeholder="Stock Qty"
                      value={bulkStock}
                      onChange={(e) => setBulkStock(e.target.value)}
                      className="w-24 px-2.5 py-1 rounded-lg border border-purple-300 bg-white text-xs font-bold"
                    />
                    <button
                      type="button"
                      onClick={handleApplyBulkToAllSizes}
                      className="px-3 py-1 rounded-lg bg-purple-800 hover:bg-purple-900 text-white text-xs font-bold cursor-pointer"
                    >
                      Apply to All {sizeRows.length} Sizes
                    </button>
                  </div>
                </div>
              )}

              {/* MASTER SKU, BARCODE & 1-CLICK SKU GENERATOR BAR */}
              <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-extrabold text-indigo-950 flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-indigo-700" />
                      <span>Master SKU, Barcode & Auto-SKU Generator</span>
                    </div>
                    <div className="text-[11px] text-indigo-800">
                      Standardized eSakhi SKU format: <code>ESK-[CATEGORY]-[SHG]-[PRODUCT]-[ID]</code> + per-size Variant SKUs
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRegenerateAllSkus()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3C1E70] hover:bg-[#2c1554] text-white text-xs font-extrabold shadow-2xs cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-[#A3E635]" />
                    <span>⚡ Auto-Generate Master & Variant SKUs</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                      Master Catalog SKU *
                    </label>
                    <input
                      type="text"
                      value={sku}
                      onChange={(e) => {
                        const nextMaster = e.target.value.toUpperCase();
                        setSku(nextMaster);
                        setSizeRows((prev) =>
                          prev.map((r, i) => ({
                            ...r,
                            sku: buildClientVariantSku(nextMaster, r.label, i),
                          }))
                        );
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-indigo-300 bg-white text-xs font-mono font-bold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                      GS1 India EAN-13 Barcode
                    </label>
                    <input
                      type="text"
                      value={barcode}
                      onChange={(e) => setBarcode(e.target.value)}
                      placeholder="890..."
                      className="w-full px-2.5 py-1.5 rounded-lg border border-indigo-300 bg-white text-xs font-mono font-bold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                      Quick Lookup by Master SKU / Barcode
                    </label>
                    <div className="flex gap-1.5">
                      <select
                        value={skuSearchInput}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSkuSearchInput(val);
                          const found = findMasterProduct(val);
                          if (found) handleApplyMasterCatalogSku(found);
                        }}
                        className="w-full px-2 py-1.5 rounded-lg border border-indigo-300 bg-white text-xs font-semibold text-slate-800"
                      >
                        <option value="">Select Master SKU Template…</option>
                        {MASTER_PRODUCT_CATALOG.map((mp) => (
                          <option key={mp.masterSku} value={mp.masterSku}>
                            {mp.masterSku} — {mp.name.slice(0, 28)} (₹{mp.suggestedBasePrice})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* MEESHO UNIFIED SIZE, PRICE, MRP & INVENTORY MATRIX TABLE */}
              <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-2xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 border-b border-slate-200 text-[10px] font-extrabold uppercase tracking-wider">
                      <th className="py-2.5 px-2.5">{activePreset.attributeKey}</th>
                      <th className="py-2.5 px-2">Selling Price (₹) *</th>
                      <th className="py-2.5 px-2">Printed MRP (₹) *</th>
                      <th className="py-2.5 px-2">Stock (Qty) *</th>
                      <th className="py-2.5 px-2">SKU ID</th>
                      <th className="py-2.5 px-2">Bank Payout</th>
                      <th className="py-2.5 px-1.5 text-center">Del</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {sizeRows.map((row, idx) => {
                      const rowFin = computeRowFinancials(row);
                      const rowPriceNum = Number(row.sellingPrice) || 0;
                      const rowMrpNum = Number(row.mrp) || 0;
                      const isMrpInvalid = rowMrpNum > 0 && rowPriceNum > rowMrpNum;
                      const isFloorInvalid = rowPriceNum > 0 && rowPriceNum < 5;

                      return (
                        <tr
                          key={row.id}
                          onClick={() => setActivePreviewRowIdx(idx)}
                          className={`transition-colors ${
                            activePreviewRowIdx === idx ? 'bg-purple-50/40' : 'hover:bg-slate-50'
                          }`}
                        >
                          {/* 1. Size / Weight Label */}
                          <td className="py-2.5 px-2.5 font-extrabold text-slate-900 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 border border-slate-300 text-xs font-black text-slate-900">
                              {row.label}
                            </span>
                            {rowFin.isMoqLocked && (
                              <div className="text-[9px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded mt-1 block">
                                Pack of {rowFin.minOrderQuantity} (₹{rowFin.packSellingPrice})
                              </div>
                            )}
                          </td>

                          {/* 2. Selling Price */}
                          <td className="py-2.5 px-2">
                            <div className="relative w-20">
                              <span className="absolute left-2 top-1.5 text-slate-400 font-bold text-xs">₹</span>
                              <input
                                type="number"
                                min="5"
                                value={row.sellingPrice}
                                onChange={(e) => updateSizeRow(idx, 'sellingPrice', e.target.value)}
                                className={`w-full pl-5 pr-1.5 py-1 rounded-lg border text-xs font-extrabold text-slate-900 ${
                                  isFloorInvalid
                                    ? 'border-rose-500 bg-rose-50'
                                    : 'border-slate-300 bg-white'
                                }`}
                              />
                            </div>
                            <div className="text-[9px] text-slate-500 mt-0.5">
                              Return: ₹{row.wrongDefectivePrice}
                            </div>
                          </td>

                          {/* 3. MRP */}
                          <td className="py-2.5 px-2">
                            <div className="relative w-20">
                              <span className="absolute left-2 top-1.5 text-slate-400 font-bold text-xs">₹</span>
                              <input
                                type="number"
                                min="5"
                                value={row.mrp}
                                onChange={(e) => updateSizeRow(idx, 'mrp', e.target.value)}
                                className={`w-full pl-5 pr-1.5 py-1 rounded-lg border text-xs font-bold text-slate-900 ${
                                  isMrpInvalid
                                    ? 'border-rose-500 bg-rose-50'
                                    : 'border-slate-300 bg-white'
                                }`}
                              />
                            </div>
                            {isMrpInvalid ? (
                              <div className="text-[9px] font-bold text-rose-600 mt-0.5">
                                ≥ ₹{row.sellingPrice}
                              </div>
                            ) : rowMrpNum > rowPriceNum && rowPriceNum > 0 ? (
                              <div className="text-[9px] font-bold text-emerald-700 mt-0.5">
                                {Math.round(((rowMrpNum - rowPriceNum) / rowMrpNum) * 100)}% OFF
                              </div>
                            ) : null}
                          </td>

                          {/* 4. Inventory / Stock Qty */}
                          <td className="py-2.5 px-2">
                            <input
                              type="number"
                              min="0"
                              value={row.stock}
                              onChange={(e) => updateSizeRow(idx, 'stock', e.target.value)}
                              className="w-16 px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs font-extrabold text-slate-900"
                            />
                            <div className="text-[9px] text-slate-400 mt-0.5">Units</div>
                          </td>

                          {/* 5. SKU ID */}
                          <td className="py-2.5 px-2">
                            <input
                              type="text"
                              value={row.sku}
                              onChange={(e) => updateSizeRow(idx, 'sku', e.target.value)}
                              className="w-24 px-2 py-1 rounded-lg border border-slate-300 bg-white text-[11px] font-mono text-slate-800"
                            />
                          </td>

                          {/* 6. Net Bank Payout */}
                          <td className="py-2.5 px-2 whitespace-nowrap">
                            <div className="text-xs font-black text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg inline-block">
                              ₹{rowFin.netBankPayout.toFixed(2)}
                            </div>
                            <div className="text-[9px] text-slate-500 mt-0.5">
                              {rowFin.minOrderQuantity > 1
                                ? `pack of ${rowFin.minOrderQuantity}`
                                : 'in bank'}
                            </div>
                          </td>

                          {/* 7. Delete Row */}
                          <td className="py-2.5 px-1.5 text-center">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSizeOption(row.label);
                              }}
                              className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                              title="Remove this size"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Total Stock & ₹30 Minimum Order Rule Footnote */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 bg-slate-50 px-3.5 py-2.5 rounded-xl border border-slate-200">
                <div>
                  <strong>Total Stock Across {sizeRows.length} Sizes:</strong>{' '}
                  <span className="font-black text-slate-900">{totalStockAcrossSizes} Units</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  💡 <strong>Hyperlocal Rule:</strong> Any size priced between ₹5–₹29 automatically bundles into a ₹30 minimum pack so the ₹15 delivery fee stays economical.
                </div>
              </div>
            </div>

            {/* =============================================================== */}
            {/* STEP 3: PRODUCT NAME, CATEGORY ATTRIBUTES & AUTO-COMPLIANCE     */}
            {/* =============================================================== */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-2xs space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#3C1E70] text-white text-xs font-black flex items-center justify-center">
                    3
                  </span>
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-900">
                      {lang === 'hi'
                        ? 'उत्पाद का नाम और विवरण (Meesho कैटलॉग विशेषताएं)'
                        : 'Product Title & Category Specifications'}
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Fill out basic product attributes so customers can easily find your item.
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-md border border-purple-200">
                  Step 3 of 3
                </span>
              </div>

              {/* Product Title & Brand */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                <div className="sm:col-span-8">
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    {lang === 'hi' ? 'उत्पाद का नाम (Product Title) *' : 'Product Name / Title *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Homemade Raw Mango Pickle (Aam Ka Achar) or Handloom Chanderi Silk Saree"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-[#3C1E70]"
                  />
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Brand / SHG Name
                  </label>
                  <input
                    type="text"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900"
                  />
                </div>
              </div>

              {/* Meesho-Style Category Specific Attribute Grid */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">
                    {attrMeta.groupTitle}
                  </div>
                  <span className="text-[10px] font-bold text-purple-800 bg-purple-100 px-2 py-0.5 rounded">
                    Click a chip below any field to quick-fill
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      {attrMeta.label1}
                    </label>
                    <input
                      type="text"
                      value={attrFabricOrMaterial}
                      onChange={(e) => setAttrFabricOrMaterial(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-900"
                    />
                    <div className="flex flex-wrap gap-1 mt-1">
                      {attrMeta.chips1.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setAttrFabricOrMaterial(chip)}
                          className="px-2 py-0.5 rounded bg-white hover:bg-purple-50 border border-slate-200 text-[10px] font-medium text-slate-600 hover:text-purple-800 cursor-pointer"
                        >
                          + {chip}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      {attrMeta.label2}
                    </label>
                    <input
                      type="text"
                      value={attrPatternOrType}
                      onChange={(e) => setAttrPatternOrType(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-900"
                    />
                    <div className="flex flex-wrap gap-1 mt-1">
                      {attrMeta.chips2.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setAttrPatternOrType(chip)}
                          className="px-2 py-0.5 rounded bg-white hover:bg-purple-50 border border-slate-200 text-[10px] font-medium text-slate-600 hover:text-purple-800 cursor-pointer"
                        >
                          + {chip}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      {attrMeta.label3}
                    </label>
                    <input
                      type="text"
                      value={attrOccasionOrShelfLife}
                      onChange={(e) => setAttrOccasionOrShelfLife(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-900"
                    />
                    <div className="flex flex-wrap gap-1 mt-1">
                      {attrMeta.chips3.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setAttrOccasionOrShelfLife(chip)}
                          className="px-2 py-0.5 rounded bg-white hover:bg-purple-50 border border-slate-200 text-[10px] font-medium text-slate-600 hover:text-purple-800 cursor-pointer"
                        >
                          + {chip}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      {attrMeta.label4}
                    </label>
                    <input
                      type="text"
                      value={attrPackOrBlouseInfo}
                      onChange={(e) => setAttrPackOrBlouseInfo(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-900"
                    />
                    <div className="flex flex-wrap gap-1 mt-1">
                      {attrMeta.chips4.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setAttrPackOrBlouseInfo(chip)}
                          className="px-2 py-0.5 rounded bg-white hover:bg-purple-50 border border-slate-200 text-[10px] font-medium text-slate-600 hover:text-purple-800 cursor-pointer"
                        >
                          + {chip}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Net Quantity (N), Package Weight & Country of Origin */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Net Quantity (N)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={netQuantity}
                      onChange={(e) => setNetQuantity(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Parcel Weight (for Rider)
                    </label>
                    <div className="flex">
                      <input
                        type="number"
                        value={weight}
                        onChange={(e) => setWeight(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-l-lg border border-slate-300 bg-white text-xs font-bold text-slate-900"
                      />
                      <select
                        value={weightUnit}
                        onChange={(e) => setWeightUnit(e.target.value as 'g' | 'kg')}
                        className="px-2 py-1.5 rounded-r-lg border-y border-r border-slate-300 bg-slate-100 text-xs font-bold text-slate-700"
                      >
                        <option value="g">g</option>
                        <option value="kg">kg</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Country of Origin
                    </label>
                    <input
                      type="text"
                      value={countryOfOrigin}
                      onChange={(e) => setCountryOfOrigin(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900"
                    />
                  </div>
                </div>
              </div>

              {/* Description with 1-Tap Auto-Write */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <label className="text-xs font-bold text-slate-800">
                    Product Description (Optional — or click Auto-Write)
                  </label>
                  <button
                    type="button"
                    onClick={handleAutoWriteDescription}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 text-[11px] font-bold cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>✨ Auto-Write Description from Sizes & Details</span>
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe your product or click 'Auto-Write Description' above..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs leading-relaxed text-slate-900"
                />
              </div>

              {/* Read-Only Store Tax Status Banner (Auto-Synced from Seller Profile — No Radio Buttons) */}
              <div className="pt-3 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">
                    Store Tax & Bill Compliance (Auto-Synced from Store Profile)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowTaxHelp(!showTaxHelp)}
                    className="text-[11px] text-purple-700 font-bold flex items-center gap-1"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>{showTaxHelp ? 'Hide Tax Info' : 'How Tax Works'}</span>
                  </button>
                </div>

                {showTaxHelp && (
                  <div className="p-3.5 bg-purple-50 border border-purple-200 rounded-xl text-[11px] space-y-1.5 text-purple-950">
                    <div>
                      • <strong>Enrolment ID Artisans:</strong> 0.0% GST on customer Bill of Supply, ₹0 GST TCS, and optional HSN code.
                    </div>
                    <div>
                      • <strong>GSTIN Merchants:</strong> HSN code mandatory, intra-state CGST + SGST on Tax Invoice, and 0.5% GSTR-8 TCS credit in your GST Cash Ledger.
                    </div>
                  </div>
                )}

                {taxProfile === 'NON_GST_ENROLMENT' ? (
                  <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/70 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0" />
                      <div>
                        <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                          <span>Enrolment ID Artisan · 0.0% GST (Bill of Supply)</span>
                          <span className="text-[10px] font-extrabold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300">
                            ✓ Locked by Law
                          </span>
                        </div>
                        <div className="text-[11px] text-emerald-900">
                          ID: <strong>{registeredEnrolmentId}</strong> · Exempt from GST & Section 52 TCS under Notification 34/2023-CT.
                        </div>
                      </div>
                    </div>
                    <div className="w-full sm:w-56">
                      <input
                        type="text"
                        value={hsnCode}
                        onChange={(e) => setHSNCode(e.target.value)}
                        placeholder="HSN Code (Optional)"
                        className="w-full px-3 py-1.5 rounded-lg border border-emerald-300 bg-white text-xs text-slate-900"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl border border-purple-200 bg-purple-50/70 grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                    <div className="sm:col-span-1">
                      <div className="text-xs font-bold text-purple-950">
                        GSTIN: {registeredGstin || '23AAAAA0000A1Z5'}
                      </div>
                      <div className="text-[10px] text-purple-800">
                        Splits 50/50 CGST + SGST · 0.5% TCS
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                        HSN / SAC Code *
                      </label>
                      <input
                        type="text"
                        required
                        value={hsnCode}
                        onChange={(e) => setHSNCode(e.target.value)}
                        placeholder="e.g. 5208, 1905"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                        GST Slab (%)
                      </label>
                      <select
                        value={gstRate}
                        onChange={(e) => setGstRate(Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                      >
                        <option value={0}>0% (Exempt)</option>
                        <option value={5}>5% (CGST 2.5% + SGST 2.5%)</option>
                        <option value={12}>12% (CGST 6% + SGST 6%)</option>
                        <option value={18}>18% (CGST 9% + SGST 9%)</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* =============================================================== */}
          {/* RIGHT 4 COLUMNS: LIVE MEESHO BUYER CARD & PAYOUT PREVIEW        */}
          {/* =============================================================== */}
          <div className="lg:col-span-4 space-y-5">
            {/* 1. LIVE CUSTOMER APP PREVIEW WITH CLICKABLE SIZE / WEIGHT CHIPS */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                  Live Customer App Preview
                </h2>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  Interactive
                </span>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs">
                <div className="aspect-4/3 bg-slate-100 relative">
                  <img
                    src={
                      imageUrls[0] ||
                      'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80'
                    }
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                  {discountPercent > 0 && (
                    <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-[#A3E635] text-slate-950 font-black text-[10px]">
                      {discountPercent}% OFF
                    </span>
                  )}
                  <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/75 text-white text-[10px] font-bold">
                    🚚 ₹15 Local Delivery
                  </span>
                </div>

                <div className="p-3.5 space-y-2.5">
                  <div className="text-[10px] font-bold text-purple-700 uppercase tracking-wider">
                    {brand || 'Damoh SHG Collective'}
                  </div>
                  <div className="text-sm font-bold text-slate-900 line-clamp-2">
                    {title || `${productType} (${primaryRow.label})`}
                  </div>

                  {/* Interactive Size / Weight Selector on Buyer Card */}
                  <div className="pt-1">
                    <div className="text-[10px] font-bold text-slate-500 mb-1">
                      Select {activePreset.attributeKey} (Click to preview price):
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {sizeRows.map((r, idx) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setActivePreviewRowIdx(idx)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold border transition-all cursor-pointer ${
                            activePreviewRowIdx === idx
                              ? 'border-[#3C1E70] bg-purple-100 text-[#3C1E70]'
                              : 'border-slate-200 bg-slate-50 text-slate-700'
                          }`}
                        >
                          {r.label} · ₹{r.sellingPrice}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-baseline gap-2 pt-1">
                    <span className="text-lg font-black text-slate-900">
                      ₹{financials.packSellingPrice.toFixed(0)}
                    </span>
                    {numCompare > numSelling && (
                      <span className="text-xs text-slate-400 line-through">
                        ₹{(numCompare * financials.minOrderQuantity).toFixed(0)}
                      </span>
                    )}
                    <span className="text-[11px] text-slate-500 font-semibold">
                      ({primaryRow.label}
                      {financials.minOrderQuantity > 1
                        ? ` · Pack of ${financials.minOrderQuantity}`
                        : ''}
                      )
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. NET BANK SETTLEMENT & CUSTOMER BILL FOR SELECTED SIZE */}
            <div className="bg-gradient-to-br from-[#1E1B4B] to-[#311042] text-white rounded-2xl p-5 shadow-md space-y-3.5">
              <div className="flex items-center justify-between border-b border-white/15 pb-2.5">
                <div>
                  <span className="text-xs font-extrabold uppercase tracking-wider text-purple-200 block">
                    Bank Payout ({primaryRow.label})
                  </span>
                  <span className="text-[10px] text-purple-300">
                    {taxProfile === 'GST_REGISTERED'
                      ? 'Tax Invoice (CGST+SGST)'
                      : 'Bill of Supply (0% GST)'}
                  </span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 font-bold">
                  Stock: {primaryRow.stock}
                </span>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-purple-100">
                  <span>
                    Selling Price ({primaryRow.label}
                    {financials.minOrderQuantity > 1 ? ` × ${financials.minOrderQuantity}` : ''}):
                  </span>
                  <span className="font-bold">₹{financials.packSellingPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-purple-200/80 text-[11px]">
                  <span>+ Customer Delivery Fee:</span>
                  <span>₹{deliveryFeeRupees.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-white font-extrabold pt-1 border-t border-white/10">
                  <span>Total Customer Pays:</span>
                  <span className="text-[#A3E635]">₹{customerTotalBill.toFixed(2)}</span>
                </div>

                <div className="pt-2 border-t border-white/15 space-y-1 text-[11px]">
                  <div className="flex justify-between text-rose-200">
                    <span>Platform Commission ({financials.categoryCommissionRate}%):</span>
                    <span>-₹{financials.commissionAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-rose-200">
                    <span>18% GST on Commission:</span>
                    <span>-₹{financials.gstOnCommission.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sky-200">
                    <span>GST TCS (Sec 52 · GSTR-8):</span>
                    <span>
                      {taxProfile === 'GST_REGISTERED'
                        ? `-₹${financials.gstTcsAmount.toFixed(2)}`
                        : '₹0.00 (Enrolment Exempt)'}
                    </span>
                  </div>
                  <div className="flex justify-between text-amber-200">
                    <span>Income Tax TDS (Sec 194-O):</span>
                    <span>
                      {annualSalesExceeds5Lakh
                        ? `-₹${financials.incomeTaxTdsAmount.toFixed(2)} (0.1% >₹5L)`
                        : `₹0.00 (FY Sales ₹${Math.round(fyGrossSalesPaise / 100).toLocaleString('en-IN')} ≤ ₹5L)`}
                    </span>
                  </div>
                </div>

                <div className="pt-2.5 border-t border-white/20 flex justify-between items-baseline">
                  <div>
                    <div className="text-xs font-extrabold text-white">Net Bank Settlement</div>
                    <div className="text-[10px] text-purple-300">Direct NEFT/UPI to your bank</div>
                  </div>
                  <div className="text-xl font-black text-[#A3E635]">
                    ₹{financials.netBankPayout.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
