import { productMaster } from './productMaster.js';

export const categoryMaster = [
  {
    categoryId: 'home-and-living',
    categoryName: 'Home and Living',
    icon: 'home',
    subcategories: [
      { subcategoryId: 'home-textiles', subcategoryName: 'Home Textiles' },
      { subcategoryId: 'kitchen-dining', subcategoryName: 'Kitchen & Dining' },
      { subcategoryId: 'home-decor-handicrafts', subcategoryName: 'Home Decor & Handicrafts' },
      { subcategoryId: 'bags-storage', subcategoryName: 'Bags & Storage' },
      { subcategoryId: 'household-essentials', subcategoryName: 'Household Essentials' },
      { subcategoryId: 'handicrafts-gifts', subcategoryName: 'Handicrafts & Gifts' },
    ],
  },
  {
    categoryId: 'womens-apparel-accessories',
    categoryName: "Women's Apparel and Accessories",
    icon: 'women',
    subcategories: [
      { subcategoryId: 'jewellery-accessories', subcategoryName: 'Jewellery & Accessories' },
      { subcategoryId: 'dupattas-scarves', subcategoryName: 'Dupattas & Scarves' },
      { subcategoryId: 'sarees-clothing', subcategoryName: 'Sarees & Clothing' },
      { subcategoryId: 'bags-accessories', subcategoryName: 'Bags & Accessories' },
    ],
  },
  {
    categoryId: 'mens-apparel-accessories',
    categoryName: "Men's Apparel and Accessories",
    icon: 'men',
    subcategories: [
      { subcategoryId: 'mens-clothing', subcategoryName: "Men's Clothing" },
      { subcategoryId: 'mens-accessories', subcategoryName: "Men's Accessories" },
    ],
  },
  {
    categoryId: 'personal-care',
    categoryName: 'Personal Care',
    icon: 'care',
    subcategories: [
      { subcategoryId: 'handmade-soaps', subcategoryName: 'Handmade Soaps' },
      { subcategoryId: 'skin-hair-care', subcategoryName: 'Skin & Hair Care' },
      { subcategoryId: 'oils-fragrance', subcategoryName: 'Oils & Fragrances' },
      { subcategoryId: 'personal-hygiene', subcategoryName: 'Personal Hygiene' },
    ],
  },
  {
    categoryId: 'food-items',
    categoryName: 'Food Items',
    icon: 'food',
    subcategories: [
      { subcategoryId: 'papad-snacks', subcategoryName: 'Papad & Snacks' },
      { subcategoryId: 'pickles-preserves', subcategoryName: 'Pickles & Preserves' },
      { subcategoryId: 'grains-pulses-spices', subcategoryName: 'Grains, Pulses & Spices' },
      { subcategoryId: 'honey-dairy-products', subcategoryName: 'Honey & Dairy Products' },
    ],
  },
  {
    categoryId: 'kids-toys-accessories',
    categoryName: 'Kids Toys & Accessories',
    icon: 'kids',
    subcategories: [
      { subcategoryId: 'wooden-traditional-toys', subcategoryName: 'Wooden & Traditional Toys' },
      { subcategoryId: 'dolls-soft-toys', subcategoryName: 'Dolls & Soft Toys' },
      { subcategoryId: 'baby-toys-accessories', subcategoryName: 'Baby Toys & Accessories' },
      { subcategoryId: 'kids-accessories', subcategoryName: 'Kids Accessories' },
    ],
  },
] as const;

export type CategoryId = (typeof categoryMaster)[number]['categoryId'];

export interface CategorySelection {
  categoryId: string;
  categoryName: string;
  subcategoryId: string;
  subcategoryName: string;
  productType: string;
  isFoodProduct: boolean;
}

export function getCategoryHierarchy() {
  return categoryMaster.map((category) => ({
    ...category,
    subcategories: category.subcategories.map((subcategory) => ({
      ...subcategory,
      productTypes: productMaster
        .filter((entry) => entry.categoryId === category.categoryId && entry.subcategoryId === subcategory.subcategoryId)
        .map((entry) => ({
          productTypeId: entry.productTypeId,
          productType: entry.productTypeName,
          isFoodProduct: entry.isFoodProduct,
          classificationStatus: entry.classificationStatus,
          reviewNote: entry.reviewNote,
        })),
    })),
  }));
}

export function getCategorySelection(categoryId: string, subcategoryId: string, productType: string): CategorySelection | null {
  const category = categoryMaster.find((entry) => entry.categoryId === categoryId);
  const subcategory = category?.subcategories.find((entry) => entry.subcategoryId === subcategoryId);
  if (!category || !subcategory) return null;

  return {
    categoryId: category.categoryId,
    categoryName: category.categoryName,
    subcategoryId: subcategory.subcategoryId,
    subcategoryName: subcategory.subcategoryName,
    productType: productType.trim(),
    isFoodProduct: category.categoryId === 'food-items',
  };
}

export function isKnownProductType(categoryId: string, subcategoryId: string, productType: string): boolean {
  const normalizedType = normalize(productType);
  return productMaster.some((entry) =>
    entry.categoryId === categoryId
    && entry.subcategoryId === subcategoryId
    && entry.classificationStatus === 'classified'
    && normalize(entry.productTypeName) === normalizedType);
}

export function classifyLegacyProduct(input: { name: string; description: string; category: string }) {
  const text = normalize(`${input.name} ${input.description}`);
  const legacyCategory = input.category.trim().toLowerCase();

  if (legacyCategory === 'bangles' || legacyCategory === 'jewellery' || legacyCategory === 'jewelry') {
    const productType = legacyCategory === 'bangles' ? 'Bangles' : inferJewelleryType(text);
    return getCategorySelection('womens-apparel-accessories', 'jewellery-accessories', productType);
  }
  if (legacyCategory === 'dupattas') {
    return getCategorySelection('womens-apparel-accessories', 'dupattas-scarves', 'Dupatta');
  }

  const matches = productMaster.filter((entry) => {
    const type = normalize(entry.productTypeName);
    return type.length >= 5 && (text.includes(type) || type.includes(normalize(input.name)));
  });
  const targets = new Map(matches.map((entry) => [
    `${entry.categoryId ?? ''}:${entry.subcategoryId ?? ''}`,
    entry,
  ]));
  if (targets.size !== 1) return null;

  const [entry] = targets.values();
  if (!entry || entry.classificationStatus !== 'classified' || !entry.categoryId || !entry.subcategoryId || !entry.subcategoryName) return null;
  const category = categoryMaster.find((item) => item.categoryId === entry.categoryId);
  if (!category) return null;
  const exactMatch = matches.find((match) => normalize(match.productTypeName) === normalize(input.name));

  return {
    categoryId: category.categoryId,
    categoryName: category.categoryName,
    subcategoryId: entry.subcategoryId,
    subcategoryName: entry.subcategoryName,
    productType: exactMatch?.productTypeName ?? input.name.trim(),
    isFoodProduct: entry.isFoodProduct,
  };
}

export function detectFoodProduct(input: { name: string; description: string }): boolean {
  const text = normalize(`${input.name} ${input.description}`);
  return productMaster.some((entry) => {
    if (!entry.isFoodProduct) return false;
    const type = normalize(entry.productTypeName);
    return type.length >= 5 && (text.includes(type) || type.includes(normalize(input.name)));
  });
}

function inferJewelleryType(text: string): string {
  if (text.includes('earring')) return 'Earrings';
  if (text.includes('necklace') || text.includes('pendant')) return 'Necklaces';
  if (text.includes('bangle')) return 'Bangles';
  if (text.includes('anklet')) return 'Anklets';
  if (text.includes('bracelet')) return 'Bracelets';
  return 'Jewellery & Accessories';
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
