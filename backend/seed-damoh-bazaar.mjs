import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config({ path: './backend/.env' });

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB Atlas');

  const usersCol = mongoose.connection.collection('users');
  const productsCol = mongoose.connection.collection('products');
  const applicationsCol = mongoose.connection.collection('sellerapplications');

  // Find or create sellers for the local shops
  const shops = [
    {
      phoneE164: '+919425123001',
      name: 'Ramesh Patel',
      shopName: 'Damoh Fresh Dairy (Ghanta Ghar)',
      role: 'seller',
    },
    {
      phoneE164: '+919425123002',
      name: 'Krishna Kumar Sahu',
      shopName: 'Krishna Kirana & Milk Booth (Nuri Nagar)',
      role: 'seller',
    },
    {
      phoneE164: '+919425123003',
      name: 'Shree Ram Tiwari',
      shopName: 'Shree Ram Kirana Store (Pathani Mohalla)',
      role: 'seller',
    },
    {
      phoneE164: '+919425123004',
      name: 'Mohan Lal Halwai',
      shopName: 'Purani Bazar Mithai Bhandar (Purani Bazar)',
      role: 'seller',
    },
    {
      phoneE164: '+919425123005',
      name: 'Sunita Jain',
      shopName: 'Civil Lines Organic Bakery (Civil Lines)',
      role: 'seller',
    },
  ];

  const sellerMap = new Map();

  for (const shop of shops) {
    let user = await usersCol.findOne({ phoneE164: shop.phoneE164 });
    if (!user) {
      const res = await usersCol.insertOne({
        phoneE164: shop.phoneE164,
        name: shop.name,
        role: 'seller',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      user = { _id: res.insertedId, ...shop };
    }
    sellerMap.set(shop.shopName, user._id);

    // Upsert approved seller application so sellerName returns shopName
    await applicationsCol.updateOne(
      { phoneE164: shop.phoneE164 },
      {
        $set: {
          sellerId: user._id,
          phoneE164: shop.phoneE164,
          shgName: shop.shopName,
          status: 'approved',
          fssaiStatus: 'verified',
          fssaiRegistrationNumber: '12345678901234',
          reviewedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  // Define realistic Bazaar to Home products
  const productsToSeed = [
    {
      slug: 'fresh-desi-cow-milk-1-litre',
      name: 'Fresh Desi Cow Milk (1 Litre Pouch)',
      description: 'Daily fresh, pure cow milk sourced directly from local dairy farms. Chilled and hygienically packed for morning & evening delivery.',
      category: 'Food Items',
      categoryId: 'food-items',
      categoryName: 'Food Items',
      subcategoryId: 'honey-dairy-products',
      subcategoryName: 'Honey & Dairy Products',
      productType: 'Fresh milk',
      isFoodProduct: true,
      classificationStatus: 'classified',
      approvalStatus: 'approved',
      foodComplianceStatus: 'verified',
      sellerId: sellerMap.get('Damoh Fresh Dairy (Ghanta Ghar)'),
      pricePaise: 6400, // Rs 64
      basePricePaise: 6400,
      stock: 45,
      lowStockThreshold: 5,
      isActive: true,
      isArchived: false,
      imageUrls: ['https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=800&q=80'],
    },
    {
      slug: 'amul-taaza-toned-milk-500ml',
      name: 'Amul Taaza Toned Milk (500ml)',
      description: 'Pasteurized homogenized toned milk. Kept refrigerated at 4°C. Perfect for daily tea, coffee and family health.',
      category: 'Food Items',
      categoryId: 'food-items',
      categoryName: 'Food Items',
      subcategoryId: 'honey-dairy-products',
      subcategoryName: 'Honey & Dairy Products',
      productType: 'Toned milk',
      isFoodProduct: true,
      classificationStatus: 'classified',
      approvalStatus: 'approved',
      foodComplianceStatus: 'verified',
      sellerId: sellerMap.get('Krishna Kirana & Milk Booth (Nuri Nagar)'),
      pricePaise: 2700, // Rs 27
      basePricePaise: 2700,
      stock: 60,
      lowStockThreshold: 10,
      isActive: true,
      isArchived: false,
      imageUrls: ['https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=800&q=80'],
    },
    {
      slug: 'pure-bundelkhand-sharbati-atta-5kg',
      name: 'Pure Bundelkhand Sharbati Atta (5kg)',
      description: '100% whole wheat stone-ground chakki fresh Sharbati atta sourced from Damoh farmers. Makes soft, fluffy rotis.',
      category: 'Food Items',
      categoryId: 'food-items',
      categoryName: 'Food Items',
      subcategoryId: 'grains-pulses-spices',
      subcategoryName: 'Grains, Pulses & Spices',
      productType: 'Wheat flour',
      isFoodProduct: true,
      classificationStatus: 'classified',
      approvalStatus: 'approved',
      foodComplianceStatus: 'verified',
      sellerId: sellerMap.get('Shree Ram Kirana Store (Pathani Mohalla)'),
      pricePaise: 24500, // Rs 245
      basePricePaise: 24500,
      stock: 30,
      lowStockThreshold: 5,
      isActive: true,
      isArchived: false,
      imageUrls: ['https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80'],
    },
    {
      slug: 'damoh-famous-mawa-peda-500g',
      name: 'Damoh Famous Pure Mawa Peda (500g)',
      description: 'Iconic traditional Damoh peda prepared with pure condensed milk khoya and aromatic green cardamom. Melt in mouth sweetness.',
      category: 'Food Items',
      categoryId: 'food-items',
      categoryName: 'Food Items',
      subcategoryId: 'papad-snacks',
      subcategoryName: 'Papad & Snacks',
      productType: 'Traditional sweets',
      isFoodProduct: true,
      classificationStatus: 'classified',
      approvalStatus: 'approved',
      foodComplianceStatus: 'verified',
      sellerId: sellerMap.get('Purani Bazar Mithai Bhandar (Purani Bazar)'),
      pricePaise: 28000, // Rs 280
      basePricePaise: 28000,
      stock: 25,
      lowStockThreshold: 3,
      isActive: true,
      isArchived: false,
      imageUrls: ['https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?auto=format&fit=crop&w=800&q=80'],
    },
    {
      slug: 'civil-lines-fresh-whole-wheat-bread',
      name: 'Artisan Whole Wheat Brown Bread',
      description: 'Daily fresh-baked brown bread without artificial preservatives. Baked every morning at 7:00 AM.',
      category: 'Food Items',
      categoryId: 'food-items',
      categoryName: 'Food Items',
      subcategoryId: 'papad-snacks',
      subcategoryName: 'Papad & Snacks',
      productType: 'Fresh bakery bread',
      isFoodProduct: true,
      classificationStatus: 'classified',
      approvalStatus: 'approved',
      foodComplianceStatus: 'verified',
      sellerId: sellerMap.get('Civil Lines Organic Bakery (Civil Lines)'),
      pricePaise: 4500, // Rs 45
      basePricePaise: 4500,
      stock: 20,
      lowStockThreshold: 4,
      isActive: true,
      isArchived: false,
      imageUrls: ['https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80'],
    },
  ];

  for (const prod of productsToSeed) {
    await productsCol.updateOne(
      { slug: prod.slug },
      { $set: { ...prod, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    console.log(`Upserted: ${prod.name}`);
  }

  console.log('Successfully seeded Damoh Bazaar products into MongoDB!');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
