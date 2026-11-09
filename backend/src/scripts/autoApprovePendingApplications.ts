import '../config/env.js';
import { connectDatabase } from '../config/db.js';
import { User } from '../modules/auth/user.model.js';
import { SellerApplication } from '../modules/seller/sellerApplication.model.js';
import { Seller } from '../models/Seller.js';
import { DeliveryPartnerApplication } from '../modules/cityAdmin/deliveryPartnerApplication.model.js';
import { DeliveryPartner } from '../models/DeliveryPartner.js';

async function generatePartnerId(): Promise<string> {
  const count = await DeliveryPartner.countDocuments();
  return `DP-DAMOH-${String(count + 1).padStart(3, '0')}`;
}

async function runAutoApproval() {
  await connectDatabase();
  console.log('--- Starting Auto-Approval for Existing Applications ---');

  // 1. Process Seller Applications
  const pendingSellerApps = await SellerApplication.find({
    status: { $in: ['pending', 'needs_info'] },
  });
  console.log(`Found ${pendingSellerApps.length} pending/needs_info seller applications.`);

  for (const app of pendingSellerApps) {
    const city = app.city || 'Damoh';
    const sellerUser = await User.findOneAndUpdate(
      { phoneE164: app.phoneE164 },
      {
        $set: {
          role: 'seller',
          assignedCity: city,
          name: app.representative || app.shgName || 'Artisan Seller',
          status: 'active',
        },
        $setOnInsert: { phoneE164: app.phoneE164 },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    await Seller.findOneAndUpdate(
      { userId: sellerUser._id },
      {
        $set: {
          userId: sellerUser._id,
          status: 'ACTIVE',
          stepCompleted: 4,
          isOnboardingComplete: true,
          supplierDetails: {
            shgName: app.shgName || 'Artisan SHG',
            shgLeaderName: app.representative || 'Artisan Leader',
            numberOfMembers: 10,
            category: 'HANDICRAFT',
            isFoodSeller: app.primaryCategoryId === 'food-items',
            district: city,
          },
          pickupAddress: {
            streetAddress: app.registeredAddress || 'Market Area',
            locality: app.registeredAddress || city,
            city,
            state: 'Madhya Pradesh',
            pincode: '470661',
          },
        },
      },
      { upsert: true, new: true }
    );

    app.status = 'approved';
    app.sellerId = sellerUser._id;
    app.reviewedAt = new Date();
    app.reviewNote = 'Auto-approved for instant zero-supervision onboarding.';
    await app.save();

    console.log(`✓ Approved seller application for: ${app.shgName} (${app.representative}, ${app.phoneE164})`);
  }

  // 2. Process Delivery Partner Applications
  const pendingDpApps = await DeliveryPartnerApplication.find({
    status: { $in: ['pending', 'needs_info', 'action_required'] },
  });
  console.log(`Found ${pendingDpApps.length} pending delivery partner applications.`);

  for (const app of pendingDpApps) {
    const city = app.city || 'Damoh';
    const partnerUser = await User.findOneAndUpdate(
      { phoneE164: app.phoneE164 },
      {
        $set: {
          role: 'delivery_partner',
          status: 'active',
          assignedCity: city,
          serviceableLocalities: app.requestedLocalities && app.requestedLocalities.length ? app.requestedLocalities : [city],
          name: app.name,
          isOnline: true,
          availabilityStatus: 'available',
          currentLocation: { latitude: 23.8415, longitude: 79.445, updatedAt: new Date() },
        },
        $setOnInsert: { phoneE164: app.phoneE164 },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    let partner = await DeliveryPartner.findOne({ userId: partnerUser._id });
    const partnerId = partner ? partner.partnerId : await generatePartnerId();

    await DeliveryPartner.findOneAndUpdate(
      { userId: partnerUser._id },
      {
        $set: {
          userId: partnerUser._id,
          partnerId,
          operatingCity: city,
          status: 'ACTIVE',
          isAvailable: true,
          personalDetails: {
            fullName: app.name,
            phone: app.phoneE164,
            emergencyPhone: app.emergencyContactPhone || app.phoneE164,
            dob: new Date('1995-01-01'),
          },
          vehicleDetails: {
            vehicleType: app.vehicleType === 'BICYCLE' ? 'CYCLE' : 'MOTORCYCLE',
            dlNumber: app.dlNumber || undefined,
            rcNumber: app.vehicleRcNumber || undefined,
            isVerified: true,
          },
        },
      },
      { upsert: true, new: true }
    );

    app.status = 'approved';
    app.reviewedAt = new Date();
    app.reviewNote = 'Auto-approved for instant zero-supervision fleet onboarding.';
    await app.save();

    console.log(`✓ Approved delivery partner application for: ${app.name} (${app.phoneE164})`);
  }

  console.log('--- Auto-Approval Complete! ---');
  process.exit(0);
}

runAutoApproval().catch((err) => {
  console.error('Auto-approval error:', err);
  process.exit(1);
});
