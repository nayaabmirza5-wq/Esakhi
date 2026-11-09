export interface DamohProductTemplate {
  id: string;
  badge: string;
  name: string;
  shortLabel: string;
  categoryId: string;
  subcategoryId: string;
  productType: string;
  defaultPrice: number; // in rupees
  defaultStock: number;
  lowStockThreshold: number;
  description: string;
  isFood: boolean;
  fssaiRequired: boolean;
  highlights: string[];
}

export const DAMOH_PRODUCT_TEMPLATES: DamohProductTemplate[] = [
  {
    id: 'damoh-mango-pickle',
    badge: '🍲 Food & Spices',
    name: 'Damoh Authentic Desi Raw Mango Pickle 500g',
    shortLabel: 'Raw Mango Pickle (500g)',
    categoryId: 'food-items',
    subcategoryId: 'pickles-preserves',
    productType: 'Pickle',
    defaultPrice: 180,
    defaultStock: 25,
    lowStockThreshold: 5,
    description: 'Traditional home-style raw mango pickle handcrafted by rural women SHG artisans in Damoh. Prepared in pure cold-pressed mustard oil with roasted fenugreek, fennel, nigella seeds, and authentic whole spices. Zero artificial colours or chemical preservatives. 12-month natural shelf life.',
    isFood: true,
    fssaiRequired: true,
    highlights: ['Pure Mustard Oil', '100% Handcrafted', '12-Month Shelf Life'],
  },
  {
    id: 'damoh-urad-papad',
    badge: '🍲 Food & Spices',
    name: 'Handcrafted Urad Dal Papad 400g (Pack of 20)',
    shortLabel: 'Urad Dal Papad (400g)',
    categoryId: 'food-items',
    subcategoryId: 'papad-snacks',
    productType: 'Papad',
    defaultPrice: 140,
    defaultStock: 30,
    lowStockThreshold: 6,
    description: 'Crisp and traditional stone-ground urad dal papad seasoned with crushed black pepper and organic asafoetida (hing). Sun-dried naturally and packed in moisture-proof sealed containers to ensure crunchiness.',
    isFood: true,
    fssaiRequired: true,
    highlights: ['Hand-Rolled', 'Sun-Dried Naturally', 'Crushed Pepper & Hing'],
  },
  {
    id: 'damoh-chanderi-saree',
    badge: '🧵 Handloom Textiles',
    name: 'Authentic Chanderi Silk Cotton Saree with Zari Border',
    shortLabel: 'Chanderi Silk Saree',
    categoryId: 'womens-apparel-accessories',
    subcategoryId: 'sarees-clothing',
    productType: 'Chanderi saree',
    defaultPrice: 2450,
    defaultStock: 8,
    lowStockThreshold: 2,
    description: 'Authentic Bundelkhand handloom Chanderi saree woven with a blend of fine silk and soft cotton. Features an intricate traditional zari border, hand-woven motifs (bootis), and includes a matching unstitched blouse piece.',
    isFood: false,
    fssaiRequired: false,
    highlights: ['100% Handloom Weave', 'Silk-Cotton Blend', 'Intricate Zari Border'],
  },
  {
    id: 'damoh-terracotta-diyas',
    badge: '🎨 Rural Handicrafts',
    name: 'Damoh Handcrafted Terracotta Diya Set (Pack of 12)',
    shortLabel: 'Terracotta Diyas (Set of 12)',
    categoryId: 'home-and-living',
    subcategoryId: 'home-decor-handicrafts',
    productType: 'Handicraft Diya',
    defaultPrice: 150,
    defaultStock: 40,
    lowStockThreshold: 10,
    description: 'Traditional terracotta festive diyas sculpted from pure local river clay by rural pottery artisans in Damoh. Finished with natural organic terracotta ochre, eco-friendly, durable, and biodegradable.',
    isFood: false,
    fssaiRequired: false,
    highlights: ['Natural Clay Origin', '12-Piece Set', 'Eco-Friendly & Biodegradable'],
  },
  {
    id: 'damoh-herbal-soap',
    badge: '🌿 Herbal & Wellness',
    name: 'Organic Multani Mitti & Neem Cold-Process Soap 100g',
    shortLabel: 'Multani Mitti & Neem Soap',
    categoryId: 'personal-care',
    subcategoryId: 'handmade-soaps',
    productType: 'Herbal soap',
    defaultPrice: 95,
    defaultStock: 50,
    lowStockThreshold: 10,
    description: 'Handcrafted cold-process herbal soap made with mineral-rich Multani Mitti (Fuller\'s Earth), cold-pressed neem oil, and soothing aloe vera. Free from sulfates, parabens, and synthetic detergents.',
    isFood: false,
    fssaiRequired: false,
    highlights: ['Cold-Processed', 'Sulfate & Paraben Free', 'Organic Neem & Clay'],
  },
];
