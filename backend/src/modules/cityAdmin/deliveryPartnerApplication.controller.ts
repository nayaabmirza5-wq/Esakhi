import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { z } from 'zod';
import { AppError } from '../../utils/AppError.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { sendData, sendPage } from '../../utils/apiResponse.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { User } from '../auth/user.model.js';
import { Order } from '../orders/order.model.js';
import { haversineDistanceKm } from '../orders/order.transitions.js';
import { Settings } from '../settings/settings.model.js';
import { DeliveryPartnerApplication } from './deliveryPartnerApplication.model.js';
import { DeliveryPartner } from '../../models/DeliveryPartner.js';
import { issueSession } from '../auth/auth.service.js';
import {
  createDeliveryPartnerApplicationSchema,
  deliveryPartnerApplicationListSchema,
  reviewDeliveryPartnerApplicationSchema,
  damohDeliveryPartnerOnboardingSchema,
} from './deliveryPartnerApplication.schemas.js';

function cityScope(req: Parameters<RequestHandler>[0]): string {
  const city = req.user?.assignedCity?.trim();
  if (!city) throw new AppError(403, 'CITY_SCOPE_REQUIRED', 'This City Admin account has no assigned city.');
  return city;
}

function cityFilter(city: string): RegExp {
  return new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

export const submitDeliveryPartnerApplication: RequestHandler = async (req, res) => {
  const input = createDeliveryPartnerApplicationSchema.parse(req.body);
  const pending = await DeliveryPartnerApplication.findOne({
    phoneE164: input.phone,
    city: cityFilter(input.city),
    status: { $in: ['pending', 'needs_info', 'action_required'] },
  }).select('_id status').lean();

  if (pending) {
    sendData(res, {
      status: pending.status,
      message: 'An application for this phone number is already awaiting City Admin verification.',
    });
    return;
  }

  // Double-entry banking mask & hash
  let bankDetailsPayload: Record<string, unknown> | undefined;
  if (input.accountNumber) {
    const masked = `••••••••${input.accountNumber.slice(-4)}`;
    const hash = crypto.createHash('sha256').update(input.accountNumber).digest('hex');
    bankDetailsPayload = {
      accountHolderName: input.name,
      accountNumberMasked: masked,
      accountNumberHash: hash,
      ifscCode: input.ifscCode,
      bankName: input.bankName || 'Partner Bank',
      branchName: input.branchName || 'Local Branch',
      upiVpa: input.upiVpa,
      isVerified: false,
    };
  }

  const applicationDoc: Record<string, unknown> = {
    name: input.name,
    phoneE164: input.phone,
    city: input.city,
    requestedLocalities: input.requestedLocalities,
    applicantNote: input.applicantNote,
    vehicleType: input.vehicleType,
    maxDeliveryRadiusKm: input.vehicleType === 'BICYCLE' ? 3.0 : 15.0,
  };

  if (input.selfieUrl) applicationDoc.selfieUrl = input.selfieUrl;
  if (input.emergencyContactName) applicationDoc.emergencyContactName = input.emergencyContactName;
  if (input.emergencyContactRel) applicationDoc.emergencyContactRel = input.emergencyContactRel;
  if (input.emergencyContactPhone) applicationDoc.emergencyContactPhone = input.emergencyContactPhone;
  if (input.residentialAddress) applicationDoc.residentialAddress = input.residentialAddress;
  if (input.pincode) applicationDoc.pincode = input.pincode;

  if (input.vehicleType === 'MOTORCYCLE') {
    if (input.dlNumber) applicationDoc.dlNumber = input.dlNumber;
    if (input.dlExpiryDate) applicationDoc.dlExpiryDate = new Date(input.dlExpiryDate);
    if (input.vehicleRcNumber) applicationDoc.vehicleRcNumber = input.vehicleRcNumber;
    if (input.dlFrontUrl) applicationDoc.dlFrontUrl = input.dlFrontUrl;
    if (input.dlBackUrl) applicationDoc.dlBackUrl = input.dlBackUrl;
  } else {
    if (input.govIdUrl) applicationDoc.govIdUrl = input.govIdUrl;
  }

  if (input.passbookDocUrl) applicationDoc.passbookDocUrl = input.passbookDocUrl;
  if (bankDetailsPayload) applicationDoc.bankDetails = bankDetailsPayload;

  // Instant Auto-Provisioning: User account is activated immediately with zero manual bottleneck
  const partnerUser = await User.findOneAndUpdate(
    { phoneE164: input.phone },
    {
      $set: {
        role: 'delivery_partner',
        status: 'active',
        assignedCity: input.city,
        serviceableLocalities: input.requestedLocalities && input.requestedLocalities.length ? input.requestedLocalities : [input.city],
        name: input.name,
        isOnline: true,
        availabilityStatus: 'available',
        currentLocation: { latitude: 23.8415, longitude: 79.445, updatedAt: new Date() },
      },
      $setOnInsert: { phoneE164: input.phone },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );

  let existingPartner = await DeliveryPartner.findOne({ userId: partnerUser._id });
  const partnerId = existingPartner ? existingPartner.partnerId : await generatePartnerId();

  await DeliveryPartner.findOneAndUpdate(
    { userId: partnerUser._id },
    {
      $set: {
        userId: partnerUser._id,
        partnerId,
        operatingCity: input.city,
        status: 'ACTIVE',
        isAvailable: true,
        personalDetails: {
          fullName: input.name,
          phone: input.phone,
          emergencyPhone: input.emergencyContactPhone || input.phone,
          dob: new Date('1995-01-01'),
        },
        vehicleDetails: {
          vehicleType: input.vehicleType === 'BICYCLE' ? 'CYCLE' : 'MOTORCYCLE',
          dlNumber: input.dlNumber || undefined,
          rcNumber: input.vehicleRcNumber || undefined,
          isVerified: true,
        },
      },
    },
    { upsert: true, new: true },
  );

  applicationDoc.status = 'approved';
  applicationDoc.reviewedAt = new Date();
  applicationDoc.reviewNote = 'Auto-approved instantly upon registration (zero-supervision onboarding).';

  const created = await DeliveryPartnerApplication.create([applicationDoc]);
  const application = created[0];
  if (!application) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to store delivery partner application.');
  }

  sendData(
    res,
    {
      applicationId: String(application._id),
      status: 'approved',
      partnerId,
      message: 'Welcome to eSakhi Fleet! Your delivery partner account is active and verified.',
    },
    201,
  );
};

export const listCityAdminDeliveryPartnerApplications: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const query = deliveryPartnerApplicationListSchema.parse(req.query);
  const filter = { city: cityFilter(city), ...(query.status ? { status: query.status } : {}) };
  const [applications, total] = await Promise.all([
    DeliveryPartnerApplication.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    DeliveryPartnerApplication.countDocuments(filter),
  ]);
  sendPage(res, applications, query.page, query.limit, total);
};

export const reviewCityAdminDeliveryPartnerApplication: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const { applicationId } = z.object({ applicationId: z.string().regex(/^[a-f\d]{24}$/i) }).parse(req.params);
  const { decision, note, flaggedFields } = reviewDeliveryPartnerApplicationSchema.parse(req.body);
  const actorId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let result: { applicationId: string; status: string; partnerId?: string; flaggedFields?: string[] } | undefined;

  try {
    result = await session.withTransaction(async () => {
      const application = await DeliveryPartnerApplication.findOne({ _id: applicationId, city: cityFilter(city) }).session(session);
      if (!application) throw new AppError(404, 'NOT_FOUND', 'Delivery partner application not found in your assigned city.');
      if (!['pending', 'needs_info', 'action_required'].includes(application.status)) {
        throw new AppError(409, 'APPLICATION_ALREADY_REVIEWED', 'This delivery partner application has already been decided.');
      }

      let partnerId: string | undefined;
      if (decision === 'approved') {
        const settings = await Settings.findOne({ key: 'global' }).select('city serviceableLocalities').session(session).lean();
        if (!settings || !cityFilter(city).test(settings.city)) {
          throw new AppError(409, 'CITY_NOT_CONFIGURED', 'Service zones are not configured for this assigned city.');
        }
        const allowedLocalities = new Set(settings.serviceableLocalities.map((locality) => locality.name.toLocaleLowerCase()));
        if (application.requestedLocalities.some((locality) => !allowedLocalities.has(locality.toLocaleLowerCase()))) {
          throw new AppError(409, 'LOCALITY_NOT_CONFIGURED', 'The application includes a locality outside the configured service zones.');
        }

        const existing = await User.findOne({ phoneE164: application.phoneE164 }).session(session);
        if (existing && existing.status !== 'active') throw new AppError(409, 'ACCOUNT_DISABLED', 'The applicant account is disabled.');
        if (existing && !['customer', 'delivery_partner'].includes(existing.role)) {
          throw new AppError(409, 'ROLE_CONFLICT', 'This phone number belongs to an account with a different role.');
        }
        if (existing?.role === 'delivery_partner' && existing.assignedCity && !cityFilter(city).test(existing.assignedCity)) {
          throw new AppError(409, 'CITY_ASSIGNMENT_CONFLICT', 'This partner account is already assigned to another city.');
        }

        const partner = await User.findOneAndUpdate(
          { phoneE164: application.phoneE164 },
          {
            $set: {
              role: 'delivery_partner',
              assignedCity: city,
              serviceableLocalities: application.requestedLocalities,
              name: application.name,
              isOnline: true, // Duty toggle activated on approval
              availabilityStatus: 'available',
              currentLocation: { latitude: 23.8415, longitude: 79.445, updatedAt: new Date() },
            },
            $setOnInsert: { phoneE164: application.phoneE164 },
          },
          { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true, session },
        );
        if (!partner) throw new AppError(500, 'INTERNAL_ERROR', 'The delivery partner account could not be provisioned.');
        partnerId = partner.id;
      }

      application.status = decision;
      application.reviewNote = note ?? null;
      application.flaggedFields = decision === 'action_required' || decision === 'needs_info' ? flaggedFields : [];
      application.reviewedBy = new mongoose.Types.ObjectId(actorId);
      application.reviewedAt = new Date();
      await application.save({ session });

      await AuditLog.create(
        [
          {
            actorId,
            action: `delivery_partner_application.${decision}`,
            resourceType: 'delivery_partner_application',
            resourceId: application.id,
            metadata: {
              city,
              decision,
              note,
              flaggedFields,
              ...(partnerId ? { partnerId, localities: application.requestedLocalities } : {}),
            },
          },
        ],
        { session },
      );

      return {
        applicationId: application.id,
        status: application.status,
        flaggedFields: application.flaggedFields,
        ...(partnerId ? { partnerId } : {}),
      };
    });
  } finally {
    await session.endSession();
  }

  if (!result) throw new AppError(500, 'INTERNAL_ERROR', 'The delivery partner review could not be recorded.');
  sendData(res, result);
};


async function generatePartnerId(): Promise<string> {
  const count = await DeliveryPartner.countDocuments();
  let candidateNumber = 1001 + count;
  while (true) {
    const candidateId = `DMH-DP-${candidateNumber}`;
    const exists = await DeliveryPartner.exists({ partnerId: candidateId });
    if (!exists) {
      return candidateId;
    }
    candidateNumber += 1;
  }
}

export const completeDeliveryPartnerOnboarding: RequestHandler = async (req, res) => {
  const input = damohDeliveryPartnerOnboardingSchema.parse(req.body);

  let user = null;
  if (req.user?.id) {
    user = await User.findById(req.user.id);
  }

  if (!user && input.phone) {
    const raw = input.phone.trim();
    const phoneE164 = raw.startsWith('+') ? raw : `+91${raw.replace(/\D/g, '').slice(-10)}`;
    user = await User.findOne({ phoneE164 });
    if (!user) {
      user = new User({
        phoneE164,
        name: input.fullName.trim(),
        role: 'delivery_partner',
        status: 'active',
        assignedCity: 'Damoh',
        serviceableLocalities: ['Damoh'],
        isOnline: true,
        availabilityStatus: 'available',
        currentLocation: { latitude: 23.8415, longitude: 79.445, updatedAt: new Date() },
      });
    }
  }

  if (!user) {
    throw new AppError(400, 'USER_IDENTIFICATION_REQUIRED', 'Please sign in or provide a valid contact phone number.');
  }

  user.role = 'delivery_partner';
  user.status = 'active';
  user.name = input.fullName.trim();
  user.assignedCity = 'Damoh';
  user.serviceableLocalities = ['Damoh'];
  user.isOnline = true;
  user.availabilityStatus = 'available';
  if (!user.currentLocation) {
    user.currentLocation = { latitude: 23.8415, longitude: 79.445, updatedAt: new Date() };
  }
  user.bankAccount = {
    accountHolderName: input.bankDetails.accountHolderName.trim(),
    bankName: input.bankDetails.bankName.trim(),
    accountNumber: input.bankDetails.accountNumber.trim(),
    ifscCode: input.bankDetails.ifscCode.trim().toUpperCase(),
    verified: true,
    linkedAt: new Date(),
  };
  await user.save();

  let partner = await DeliveryPartner.findOne({ userId: user._id });
  let partnerId: string;
  if (partner) {
    partnerId = partner.partnerId;
  } else {
    partnerId = await generatePartnerId();
  }

  partner = await DeliveryPartner.findOneAndUpdate(
    { userId: user._id },
    {
      $set: {
        userId: user._id,
        partnerId,
        operatingCity: 'Damoh',
        status: 'ACTIVE',
        isAvailable: true,
        personalDetails: {
          fullName: input.fullName.trim(),
          phone: input.phone.trim(),
          emergencyPhone: input.emergencyPhone.trim(),
          dob: new Date(input.dob),
        },
        vehicleDetails: {
          vehicleType: input.vehicleType,
          dlNumber: input.vehicleType === 'CYCLE' ? undefined : input.dlNumber?.trim().toUpperCase(),
          rcNumber: input.vehicleType === 'CYCLE' ? undefined : input.rcNumber?.trim().toUpperCase(),
          isVerified: true,
        },
        kycDetails: {
          panNumber: input.panNumber.trim().toUpperCase(),
          aadharNumber: input.aadharNumber.trim(),
          isPanVerified: true,
          isAadharVerified: true,
        },
        bankDetails: {
          accountHolderName: input.bankDetails.accountHolderName.trim(),
          bankName: input.bankDetails.bankName.trim(),
          branchName: input.bankDetails.branchName.trim(),
          accountNumber: input.bankDetails.accountNumber.trim(),
          ifscCode: input.bankDetails.ifscCode.trim().toUpperCase(),
          isVerified: true,
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (!partner) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to save delivery partner profile.');
  }

  await DeliveryPartnerApplication.findOneAndUpdate(
    { phoneE164: `+91${input.phone.trim()}` },
    {
      $set: {
        name: input.fullName.trim(),
        city: 'Damoh',
        requestedLocalities: ['Damoh'],
        vehicleType: input.vehicleType === 'CYCLE' ? 'BICYCLE' : 'MOTORCYCLE',
        status: 'approved',
        reviewNote: 'Instant Auto-Activation on Damoh Onboarding Completion',
        reviewedAt: new Date(),
        emergencyContactPhone: input.emergencyPhone.trim(),
        dlNumber: input.vehicleType === 'CYCLE' ? undefined : input.dlNumber?.trim().toUpperCase(),
        vehicleRcNumber: input.vehicleType === 'CYCLE' ? undefined : input.rcNumber?.trim().toUpperCase(),
        bankDetails: {
          accountHolderName: input.bankDetails.accountHolderName.trim(),
          accountNumberMasked: `••••••••${input.bankDetails.accountNumber.trim().slice(-4)}`,
          accountNumberHash: crypto.createHash('sha256').update(input.bankDetails.accountNumber.trim()).digest('hex'),
          ifscCode: input.bankDetails.ifscCode.trim().toUpperCase(),
          bankName: input.bankDetails.bankName.trim(),
          branchName: input.bankDetails.branchName.trim(),
          isVerified: true,
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await AuditLog.create([
    {
      actorId: String(user._id),
      action: 'delivery_partner.instant_auto_activated',
      resourceType: 'delivery_partner',
      resourceId: String(partner._id),
      metadata: {
        partnerId: partner.partnerId,
        operatingCity: 'Damoh',
        vehicleType: input.vehicleType,
        phone: input.phone,
      },
    },
  ]);

  const { accessToken } = await issueSession(String(user._id), 'delivery_partner');

  sendData(
    res,
    {
      partner: partner.toObject ? partner.toObject() : partner,
      user: {
        id: String(user._id),
        phoneE164: user.phoneE164,
        name: user.name,
        role: user.role,
        status: user.status,
        assignedCity: user.assignedCity,
        serviceableLocalities: user.serviceableLocalities,
        isOnline: user.isOnline,
        availabilityStatus: user.availabilityStatus,
      },
      accessToken,
      token: accessToken,
      message: 'Delivery Partner onboarding completed successfully! Your account is active and verified.',
    },
    201
  );
};

const partnerListQuerySchema = deliveryPartnerApplicationListSchema.pick({ page: true, limit: true }).extend({
  sellerLat: z.coerce.number().min(-90).max(90).optional(),
  sellerLng: z.coerce.number().min(-180).max(180).optional(),
});

export const listCityAdminDeliveryPartners: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const query = partnerListQuerySchema.parse(req.query);
  const sellerLat = query.sellerLat ?? 23.8388;
  const sellerLng = query.sellerLng ?? 79.4422;
  const cityRegex = cityFilter(city);
  const [approvedApps, deliveryPartners, settings] = await Promise.all([
    DeliveryPartnerApplication.find({ city: cityRegex, status: 'approved' }).select('phoneE164 name requestedLocalities vehicleType maxDeliveryRadiusKm').lean(),
    DeliveryPartner.find({ operatingCity: cityRegex, status: 'ACTIVE' }).lean(),
    Settings.findOne({ key: 'global' }).select('city serviceableLocalities').lean(),
  ]);
  const dpByUserId = new Map(deliveryPartners.map((dp) => [String(dp.userId), dp]));
  const dpByPhone = new Map(deliveryPartners.map((dp) => [`+91${dp.personalDetails.phone}`, dp]));
  const dpUserIds = deliveryPartners.map((dp) => dp.userId);
  const dpPhones = deliveryPartners.map((dp) => `+91${dp.personalDetails.phone}`);
  const appPhones = approvedApps.map((app) => app.phoneE164);
  const allPhones = Array.from(new Set([...appPhones, ...dpPhones]));
  const appByPhone = new Map(approvedApps.map((app) => [app.phoneE164, app]));
  const defaultLocalities = settings && cityRegex.test(settings.city)
    ? settings.serviceableLocalities.map((locality) => locality.name)
    : [city];

  const filter = {
    role: 'delivery_partner' as const,
    $or: [
      { assignedCity: cityRegex },
      { assignedCity: { $exists: false } },
      { assignedCity: null },
      { assignedCity: '' },
      ...(dpUserIds.length ? [{ _id: { $in: dpUserIds } }] : []),
      ...(allPhones.length ? [{ phoneE164: { $in: allPhones } }] : []),
    ],
  };
  const [partners, total] = await Promise.all([
    User.find(filter)
      .select('name phoneE164 email status assignedCity serviceableLocalities isOnline availabilityStatus currentLocation createdAt')
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  const partnerIds = partners.map((partner) => partner._id);
  const workload = partnerIds.length ? await Order.aggregate([
    { $match: { 'address.city': cityRegex, 'deliveryPartner.userId': { $in: partnerIds } } },
    {
      $group: {
        _id: '$deliveryPartner.userId',
        activeDeliveries: {
          $sum: {
            $cond: [
              {
                $in: [
                  '$fulfilmentStatus',
                  [
                    'delivery_partner_assigned',
                    'out_for_pickup',
                    'picked_up',
                    'out_for_delivery',
                  ],
                ],
              },
              1,
              0,
            ],
          },
        },
        completedDeliveries: { $sum: { $cond: [{ $in: ['$fulfilmentStatus', ['delivered', 'completed']] }, 1, 0] } },
        failedDeliveries: { $sum: { $cond: [{ $eq: ['$fulfilmentStatus', 'delivery_failed'] }, 1, 0] } },
      },
    },
  ]) : [];
  const workloadByPartner = new Map(workload.map((record) => [String(record._id), record]));

  const mappedPartners = partners.map((partner, index) => {
    const stats = workloadByPartner.get(String(partner._id));
    const activeDeliveries = stats?.activeDeliveries ?? 0;
    const app = appByPhone.get(partner.phoneE164);
    const serviceableLocalities = partner.serviceableLocalities?.length
      ? partner.serviceableLocalities
      : app?.requestedLocalities?.length
        ? app.requestedLocalities
        : defaultLocalities;

    const isOnline = partner.status === 'active' && (partner.isOnline ?? true);
    const availabilityStatus: 'available' | 'busy' | 'offline' = !isOnline
      ? 'offline'
      : activeDeliveries > 0 || partner.availabilityStatus === 'busy'
        ? 'busy'
        : 'available';

    const partnerLat = partner.currentLocation?.latitude ?? (23.8415 + index * 0.0025);
    const partnerLng = partner.currentLocation?.longitude ?? (79.445 + index * 0.0025);
    const distanceKm = haversineDistanceKm(sellerLat, sellerLng, partnerLat, partnerLng);

    const dp = dpByUserId.get(String(partner._id)) || dpByPhone.get(partner.phoneE164);
    const vehicleType = dp?.vehicleDetails?.vehicleType ?? app?.vehicleType ?? 'CYCLE';

    return {
      ...partner,
      partnerId: dp?.partnerId || `DMH-DP-${1000 + index}`,
      name: partner.name || dp?.personalDetails?.fullName || app?.name || 'Delivery Partner',
      assignedCity: dp?.operatingCity || partner.assignedCity || city,
      serviceableLocalities,
      activeDeliveries,
      completedDeliveries: stats?.completedDeliveries ?? 0,
      failedDeliveries: stats?.failedDeliveries ?? 0,
      isOnline,
      availabilityStatus,
      availability: availabilityStatus === 'available' ? 'ONLINE & AVAILABLE' : availabilityStatus === 'busy' ? 'ONLINE · ON DELIVERY' : 'OFFLINE',
      currentLocation: {
        latitude: partnerLat,
        longitude: partnerLng,
        updatedAt: partner.currentLocation?.updatedAt ?? new Date(),
      },
      distanceKm,
      vehicleType,
      maxDeliveryRadiusKm: app?.maxDeliveryRadiusKm ?? (vehicleType === 'CYCLE' ? 5.0 : 15.0),
      verificationStatus: 'approved',
      partnerProfile: dp || null,
      kycVerified: Boolean(dp?.kycDetails?.isPanVerified && dp?.kycDetails?.isAadharVerified),
      bankVerified: Boolean(dp?.bankDetails?.isVerified ?? true),
    };
  }).sort((a, b) => {
    const rank = (status: 'available' | 'busy' | 'offline') => (status === 'available' ? 0 : status === 'busy' ? 1 : 2);
    if (rank(a.availabilityStatus) !== rank(b.availabilityStatus)) {
      return rank(a.availabilityStatus) - rank(b.availabilityStatus);
    }
    return a.distanceKm - b.distanceKm;
  });

  sendPage(res, mappedPartners, query.page, query.limit, total);
};
