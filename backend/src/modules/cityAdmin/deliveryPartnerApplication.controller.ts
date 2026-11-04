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
import {
  createDeliveryPartnerApplicationSchema,
  deliveryPartnerApplicationListSchema,
  reviewDeliveryPartnerApplicationSchema,
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

  const created = await DeliveryPartnerApplication.create([applicationDoc]);
  const application = created[0];
  if (!application) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to store delivery partner application.');
  }

  sendData(
    res,
    {
      applicationId: String(application._id),
      status: application.status,
      message: 'Profile Submitted - Under Physical Audit by City Admin. Form locked in pending queue.',
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
  const [approvedApps, settings] = await Promise.all([
    DeliveryPartnerApplication.find({ city: cityRegex, status: 'approved' }).select('phoneE164 name requestedLocalities vehicleType maxDeliveryRadiusKm').lean(),
    Settings.findOne({ key: 'global' }).select('city serviceableLocalities').lean(),
  ]);
  const appPhones = approvedApps.map((app) => app.phoneE164);
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
      ...(appPhones.length ? [{ phoneE164: { $in: appPhones } }] : []),
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
                    'placed',
                    'order_confirmed',
                    'accepted',
                    'preparing',
                    'ready_for_pickup',
                    'delivery_partner_assigned',
                    'out_for_pickup',
                    'picked_up',
                    'out_for_delivery',
                    'delivery_failed',
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

    return {
      ...partner,
      name: partner.name || app?.name || 'Delivery Partner',
      assignedCity: partner.assignedCity || city,
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
      vehicleType: app?.vehicleType ?? 'BICYCLE',
      maxDeliveryRadiusKm: app?.maxDeliveryRadiusKm ?? 3.0,
      verificationStatus: 'approved',
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
