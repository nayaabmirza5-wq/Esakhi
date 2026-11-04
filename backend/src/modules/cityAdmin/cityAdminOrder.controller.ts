import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../utils/AppError.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { sendData } from '../../utils/apiResponse.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { User } from '../auth/user.model.js';
import { Order } from '../orders/order.model.js';
import { PenaltyLedger } from '../orders/penaltyLedger.model.js';
import { cityAdminReturnArbitrationSchema } from '../orders/order.schemas.js';
import { resolveOrderSellerPickup } from '../orders/order.controller.js';
import { enqueueOrderStatusNotification } from '../notifications/orderNotification.service.js';
import { SellerApplication } from '../seller/sellerApplication.model.js';
import {
  canAssignDeliveryPartner,
  haversineDistanceKm,
  statusAfterDeliveryPartnerAssignment,
} from '../orders/order.transitions.js';

const orderParamsSchema = z.object({ orderId: z.string().regex(/^[a-f\d]{24}$/i) });
const assignPartnerSchema = z.object({
  partnerId: z.string().regex(/^[a-f\d]{24}$/i),
  reassignmentReason: z.string().trim().min(10).max(1000).optional(),
}).strict();

const ACTIVE_TRACKING_STATES = new Set([
  'delivery_partner_assigned',
  'out_for_pickup',
  'picked_up',
  'out_for_delivery',
  'return_partner_assigned',
  'return_picked_up',
]);

const COMPLETED_TRACKING_STATES = new Set([
  'delivered',
  'completed',
  'return_delivered_to_seller',
  'ready_for_refund',
  'refund_completed',
]);

function cityScope(req: Parameters<RequestHandler>[0]): string {
  const city = req.user?.assignedCity?.trim();
  if (!city) throw new AppError(403, 'CITY_SCOPE_REQUIRED', 'This City Admin account has no assigned city.');
  return city;
}

function cityFilter(city: string): RegExp {
  return new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

function localityMatches(localities: string[], locality: string): boolean {
  return localities.some((eligible) => eligible.localeCompare(locality, undefined, { sensitivity: 'accent' }) === 0);
}

export const getCityAdminOrder: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const { orderId } = orderParamsSchema.parse(req.params);
  const order = await Order.findOne({ _id: orderId, 'address.city': cityFilter(city) }).lean();
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found in your assigned city.');

  const sellerIds = [...new Set(order.items.map((item) => item.sellerId?.toString()).filter((id): id is string => Boolean(id)))];
  const [sellers, sellerApps, sellerPickup] = await Promise.all([
    sellerIds.length ? User.find({ _id: { $in: sellerIds }, role: 'seller' }).select('name phoneE164').lean() : Promise.resolve([]),
    sellerIds.length ? SellerApplication.find({ sellerId: { $in: sellerIds }, status: 'approved' }).select('sellerId shgName representative').lean() : Promise.resolve([]),
    resolveOrderSellerPickup(order),
  ]);
  const appNames = new Map(sellerApps.map((app) => [String(app.sellerId), app.shgName || app.representative]));
  const sellerNames = new Map(sellers.map((seller) => [String(seller._id), seller.name || appNames.get(String(seller._id)) || seller.phoneE164 || 'Seller']));
  sendData(res, {
    ...order,
    sellerPickup,
    items: order.items.map((item) => ({ ...item, sellerName: item.sellerId ? sellerNames.get(item.sellerId.toString()) || appNames.get(item.sellerId.toString()) || 'Seller' : 'Unassigned' })),
  });
};

export const trackCityAdminOrderPartner: RequestHandler = async (req, res) => {
  const { orderId } = orderParamsSchema.parse(req.params);
  const query: Record<string, unknown> = { _id: orderId };
  if (req.user?.role === 'city_admin') {
    const city = cityScope(req);
    query['address.city'] = cityFilter(city);
  }
  const order = await Order.findOne(query).lean();
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found.');

  const sellerPickup = await resolveOrderSellerPickup(order);
  const sellerNode = {
    sellerName: sellerPickup.sellerName,
    phoneE164: sellerPickup.phoneE164,
    address: sellerPickup.address,
    city: sellerPickup.city,
    latitude: sellerPickup.latitude ?? 23.8388,
    longitude: sellerPickup.longitude ?? 79.4422,
  };
  const customerNode = {
    name: order.address?.name || order.customerName,
    phoneE164: order.address?.phoneE164 || order.customerPhoneE164,
    address: order.address?.formattedAddress || [order.address?.addressLine1, order.address?.locality, order.address?.city, order.address?.postalCode].filter(Boolean).join(', ') || 'Customer Address',
    locality: order.address?.locality || 'Damoh',
    city: order.address?.city || sellerPickup.city || 'Damoh',
    latitude: order.address?.latitude ?? 23.8342,
    longitude: order.address?.longitude ?? 79.4385,
  };

  const isReverseCompleted = ['return_delivered_to_seller', 'ready_for_refund', 'refund_completed'].includes(order.fulfilmentStatus);
  const isCompleted = COMPLETED_TRACKING_STATES.has(order.fulfilmentStatus);
  const isActive = ACTIVE_TRACKING_STATES.has(order.fulfilmentStatus) && Boolean(order.deliveryPartner);

  if (isCompleted || !isActive) {
    const deliveredEvent = [...(order.statusHistory ?? [])].reverse().find((e) => COMPLETED_TRACKING_STATES.has(e.status));
    const terminalLat = isReverseCompleted
      ? sellerNode.latitude
      : isCompleted
        ? customerNode.latitude
        : (order.deliveryPartner?.latitude ?? sellerNode.latitude);
    const terminalLng = isReverseCompleted
      ? sellerNode.longitude
      : isCompleted
        ? customerNode.longitude
        : (order.deliveryPartner?.longitude ?? sellerNode.longitude);

    sendData(res, {
      orderId: String(order._id),
      orderReference: order.orderReference,
      fulfilmentStatus: order.fulfilmentStatus,
      streamStatus: 'GPS_STREAM_INACTIVE' as const,
      active: false,
      terminatedReason: isReverseCompleted
        ? 'RETURN_DELIVERED_TO_SELLER'
        : isCompleted
          ? 'ORDER_DELIVERED'
          : 'NOT_IN_ACTIVE_TRANSIT',
      terminatedAt: deliveredEvent?.changedAt ? new Date(deliveredEvent.changedAt).toISOString() : new Date().toISOString(),
      sellerNode,
      customerNode,
      partnerLocation: order.deliveryPartner
        ? {
            partnerId: order.deliveryPartner.userId ? String(order.deliveryPartner.userId) : undefined,
            name: order.deliveryPartner.name,
            phoneE164: order.deliveryPartner.phoneE164,
            latitude: terminalLat,
            longitude: terminalLng,
            frozen: true,
            updatedAt: deliveredEvent?.changedAt ? new Date(deliveredEvent.changedAt).toISOString() : new Date().toISOString(),
          }
        : null,
      distanceToSellerKm: isReverseCompleted
        ? 0
        : isCompleted
          ? (haversineDistanceKm(sellerNode.latitude, sellerNode.longitude, customerNode.latitude, customerNode.longitude) ?? 0)
          : 0,
      distanceToCustomerKm: isReverseCompleted
        ? (haversineDistanceKm(sellerNode.latitude, sellerNode.longitude, customerNode.latitude, customerNode.longitude) ?? 0)
        : 0,
      estimatedEtaMinutes: 0,
      signalQuality: 'terminated' as const,
    });
    return;
  }

  const partnerUser = order.deliveryPartner?.userId
    ? await User.findById(order.deliveryPartner.userId).select('name phoneE164 isOnline availabilityStatus currentLocation').lean()
    : null;

  const lastUpdated = partnerUser?.currentLocation?.updatedAt ? new Date(partnerUser.currentLocation.updatedAt) : null;
  const isFreshSignal = Boolean(lastUpdated && Date.now() - lastUpdated.getTime() < 5 * 60_000);

  let partnerLat = partnerUser?.currentLocation?.latitude ?? order.deliveryPartner?.latitude;
  let partnerLng = partnerUser?.currentLocation?.longitude ?? order.deliveryPartner?.longitude;
  let signalQuality: 'live' | 'fallback_checkpoint' = isFreshSignal ? 'live' : 'fallback_checkpoint';

  if (partnerLat == null || partnerLng == null) {
    signalQuality = 'fallback_checkpoint';
    if (order.fulfilmentStatus === 'delivery_partner_assigned' || order.fulfilmentStatus === 'out_for_pickup') {
      partnerLat = sellerNode.latitude + 0.0025;
      partnerLng = sellerNode.longitude + 0.0025;
    } else if (order.fulfilmentStatus === 'picked_up') {
      partnerLat = sellerNode.latitude;
      partnerLng = sellerNode.longitude;
    } else if (order.fulfilmentStatus === 'return_partner_assigned') {
      partnerLat = customerNode.latitude + 0.002;
      partnerLng = customerNode.longitude + 0.002;
    } else {
      partnerLat = (sellerNode.latitude + customerNode.latitude) / 2;
      partnerLng = (sellerNode.longitude + customerNode.longitude) / 2;
    }
  }

  const distanceToSellerKm = haversineDistanceKm(partnerLat, partnerLng, sellerNode.latitude, sellerNode.longitude) ?? 0;
  const distanceToCustomerKm = haversineDistanceKm(partnerLat, partnerLng, customerNode.latitude, customerNode.longitude) ?? 0;
  const isReverseActive = ['return_partner_assigned', 'return_picked_up'].includes(order.fulfilmentStatus);
  const remainingKm = isReverseActive
    ? order.fulfilmentStatus === 'return_partner_assigned'
      ? distanceToCustomerKm + (haversineDistanceKm(customerNode.latitude, customerNode.longitude, sellerNode.latitude, sellerNode.longitude) ?? 0)
      : distanceToSellerKm
    : ['delivery_partner_assigned', 'out_for_pickup'].includes(order.fulfilmentStatus)
      ? distanceToSellerKm + (haversineDistanceKm(sellerNode.latitude, sellerNode.longitude, customerNode.latitude, customerNode.longitude) ?? 0)
      : distanceToCustomerKm;
  const estimatedEtaMinutes = Math.max(2, Math.round((remainingKm / 22) * 60));

  sendData(res, {
    orderId: String(order._id),
    orderReference: order.orderReference,
    fulfilmentStatus: order.fulfilmentStatus,
    streamStatus: 'GPS_STREAM_ACTIVE' as const,
    active: true,
    sellerNode,
    customerNode,
    partnerLocation: {
      partnerId: order.deliveryPartner?.userId ? String(order.deliveryPartner.userId) : undefined,
      name: partnerUser?.name || order.deliveryPartner?.name || 'Delivery Partner',
      phoneE164: partnerUser?.phoneE164 || order.deliveryPartner?.phoneE164 || '',
      latitude: partnerLat,
      longitude: partnerLng,
      frozen: false,
      updatedAt: lastUpdated ? lastUpdated.toISOString() : new Date().toISOString(),
    },
    distanceToSellerKm,
    distanceToCustomerKm,
    estimatedEtaMinutes,
    signalQuality,
  });
};

export const assignCityAdminDeliveryPartner: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const { orderId } = orderParamsSchema.parse(req.params);
  const { partnerId, reassignmentReason } = assignPartnerSchema.parse(req.body);
  const actorId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let updated;

  try {
    updated = await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: orderId, 'address.city': cityFilter(city) }).session(session);
      if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found in your assigned city.');
      if (order.fulfilmentMethod !== 'delivery' || !canAssignDeliveryPartner(order.fulfilmentStatus, Boolean(order.deliveryPartner))) {
        throw new AppError(409, 'DELIVERY_PARTNER_NOT_ALLOWED', 'Only eligible, unassigned delivery orders or failed deliveries can be assigned.');
      }
      if (order.deliveryPartner && !reassignmentReason) {
        throw new AppError(400, 'REASSIGNMENT_REASON_REQUIRED', 'A reason is required to reassign a delivery partner.');
      }
      if (!order.address?.locality) throw new AppError(409, 'DELIVERY_LOCALITY_REQUIRED', 'A locality is required to check partner eligibility.');

      const partner = await User.findOne({
        _id: partnerId,
        role: 'delivery_partner',
        status: 'active',
        $or: [{ assignedCity: cityFilter(city) }, { assignedCity: { $exists: false } }, { assignedCity: null }, { assignedCity: '' }],
      })
        .select('_id name phoneE164 serviceableLocalities assignedCity isOnline availabilityStatus currentLocation')
        .session(session)
        .lean();
      if (!partner) throw new AppError(404, 'DELIVERY_PARTNER_NOT_FOUND', 'No active delivery partner for this city was found.');
      if (partner.isOnline === false || partner.availabilityStatus === 'offline') {
        throw new AppError(409, 'PARTNER_OFFLINE', 'The selected delivery partner is currently offline. Please select an ONLINE and AVAILABLE partner.');
      }
      const partnerLocalities = partner.serviceableLocalities?.length ? partner.serviceableLocalities : [order.address.locality];
      if (!localityMatches(partnerLocalities, order.address.locality)) {
        throw new AppError(409, 'PARTNER_ZONE_INELIGIBLE', 'This delivery partner is not approved for the order locality.');
      }

      const resolvedPickup = await resolveOrderSellerPickup(order.toObject());
      order.sellerPickup = {
        ...(resolvedPickup.sellerId ? { sellerId: new mongoose.Types.ObjectId(resolvedPickup.sellerId) } : {}),
        sellerName: resolvedPickup.sellerName,
        ...(resolvedPickup.phoneE164 ? { phoneE164: resolvedPickup.phoneE164 } : {}),
        address: resolvedPickup.address,
        city: resolvedPickup.city,
        latitude: resolvedPickup.latitude,
        longitude: resolvedPickup.longitude,
      };

      const partnerLat = partner.currentLocation?.latitude ?? 23.8415;
      const partnerLng = partner.currentLocation?.longitude ?? 79.445;
      const distanceKm = haversineDistanceKm(
        resolvedPickup.latitude,
        resolvedPickup.longitude,
        partnerLat,
        partnerLng,
      );

      const priorAssignment = order.deliveryPartner;
      if (priorAssignment) {
        order.deliveryPartnerHistory.push({
          ...(priorAssignment.userId ? { userId: priorAssignment.userId } : {}),
          name: priorAssignment.name,
          phoneE164: priorAssignment.phoneE164,
          assignedAt: priorAssignment.assignedAt,
          assignedBy: priorAssignment.assignedBy,
          unassignedAt: new Date(),
          unassignedBy: new mongoose.Types.ObjectId(actorId),
          changeReason: reassignmentReason,
        });
      }
      order.deliveryPartner = {
        userId: partner._id,
        name: partner.name || 'Delivery Partner',
        phoneE164: partner.phoneE164,
        distanceKm,
        latitude: partnerLat,
        longitude: partnerLng,
        assignedAt: new Date(),
        assignedBy: new mongoose.Types.ObjectId(actorId),
      };

      if (order.fulfilmentStatus === 'delivery_failed') {
        order.fulfilmentStatus = statusAfterDeliveryPartnerAssignment(order.fulfilmentStatus);
        order.statusHistory.push({
          status: order.fulfilmentStatus,
          changedAt: new Date(),
          actorType: 'user',
          actorId: new mongoose.Types.ObjectId(actorId),
          note: reassignmentReason || 'Partner reassigned after delivery failed.',
        });
      } else {
        order.fulfilmentStatus = 'delivery_partner_assigned';
        order.statusHistory.push({
          status: 'delivery_partner_assigned',
          changedAt: new Date(),
          actorType: 'user',
          actorId: new mongoose.Types.ObjectId(actorId),
          note: `Delivery Partner (${partner.name || 'Partner'}) assigned by City Admin — Proximity: ${distanceKm} km from Seller, Status: ONLINE & AVAILABLE.`,
        });
      }

      await order.save({ session });
      await User.updateOne(
        { _id: partner._id },
        {
          $set: {
            isOnline: true,
            availabilityStatus: 'busy',
            currentLocation: {
              latitude: partnerLat,
              longitude: partnerLng,
              updatedAt: new Date(),
            },
          },
        },
        { session },
      );
      await enqueueOrderStatusNotification(order, order.fulfilmentStatus, session);
      await AuditLog.create([{
        actorId,
        action: priorAssignment ? 'order.city_admin_delivery_partner_reassigned' : 'order.city_admin_delivery_partner_assigned',
        resourceType: 'order',
        resourceId: order.id,
        metadata: {
          city,
          partnerId: partner._id.toString(),
          distanceKm,
          fulfilmentStatus: order.fulfilmentStatus,
          ...(reassignmentReason ? { reassignmentReason } : {}),
        },
      }], { session });
      return order;
    });
  } finally {
    await session.endSession();
  }
  if (!updated) throw new AppError(500, 'INTERNAL_ERROR', 'The delivery partner could not be assigned.');
  sendData(res, updated);
};

export const arbitrateCityAdminReturnDispute: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const { orderId } = orderParamsSchema.parse(req.params);
  const input = cityAdminReturnArbitrationSchema.parse(req.body);
  const actorId = authenticatedUserId(req);

  const order = await Order.findOne({ _id: orderId, 'address.city': cityFilter(city) });
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found in your assigned city.');
  if (order.fulfilmentStatus !== 'return_requested' || !order.returnRequest) {
    throw new AppError(409, 'RETURN_ARBITRATION_NOT_ALLOWED', 'Only orders in RETURN_REQUESTED state can be arbitrated.');
  }

  const resolvedPickup = await resolveOrderSellerPickup(order.toObject());
  const penaltyPaise = Math.round((input.penaltyAmountRupees ?? 0) * 100);
  const faultAttribution = input.decision === 'approved' ? (input.faultAttribution ?? 'no_fault') : 'no_fault';

  let createdLedgerId: mongoose.Types.ObjectId | undefined;
  let penaltyPartyId: mongoose.Types.ObjectId | undefined;

  if (input.decision === 'approved' && faultAttribution === 'seller_fault' && penaltyPaise > 0) {
    const sellerIdStr = resolvedPickup.sellerId || order.items.find((i) => i.sellerId)?.sellerId?.toString();
    if (sellerIdStr) {
      penaltyPartyId = new mongoose.Types.ObjectId(sellerIdStr);
      const ledgerEntry = await PenaltyLedger.create({
        orderId: order._id,
        orderReference: order.orderReference,
        city,
        partyType: 'seller',
        partyId: penaltyPartyId,
        partyName: resolvedPickup.sellerName || 'SHG Seller',
        penaltyAmountPaise: penaltyPaise,
        reason: `Pre-dispatch/packaging discrepancy on Order #${order.orderReference}: ${input.reviewNote}`,
        faultType: 'seller_fault',
        cityAdminId: new mongoose.Types.ObjectId(actorId),
        settlementStatus: 'SELLER_PENALTY_PENDING',
      });
      createdLedgerId = ledgerEntry._id;
    }
  } else if (input.decision === 'approved' && faultAttribution === 'delivery_partner_fault' && penaltyPaise > 0) {
    const partnerId = order.deliveryPartner?.userId;
    if (partnerId) {
      penaltyPartyId = new mongoose.Types.ObjectId(String(partnerId));
      const ledgerEntry = await PenaltyLedger.create({
        orderId: order._id,
        orderReference: order.orderReference,
        city,
        partyType: 'delivery_partner',
        partyId: penaltyPartyId,
        partyName: order.deliveryPartner?.name || 'Delivery Partner',
        penaltyAmountPaise: penaltyPaise,
        reason: `Transit damage penalty on Order #${order.orderReference}: ${input.reviewNote}`,
        faultType: 'delivery_partner_fault',
        cityAdminId: new mongoose.Types.ObjectId(actorId),
        settlementStatus: 'DELIVERY_PARTNER_PENALTY_PENDING',
      });
      createdLedgerId = ledgerEntry._id;
    }
  }

  const nextStatus = input.decision === 'approved' ? 'return_accepted' : 'return_rejected';
  order.fulfilmentStatus = nextStatus;
  order.returnRequest.status = input.decision === 'approved' ? 'accepted' : 'rejected';
  order.returnRequest.arbitration = {
    decision: input.decision,
    faultAttribution,
    penaltyAmountPaise: penaltyPaise,
    ...(penaltyPartyId ? { penaltyPartyId } : {}),
    ...(createdLedgerId ? { penaltyLedgerId: createdLedgerId } : {}),
    reviewNote: input.reviewNote,
    reviewedBy: new mongoose.Types.ObjectId(actorId),
    reviewedAt: new Date(),
  };

  const penaltySummaryText =
    input.decision === 'approved' && faultAttribution !== 'no_fault' && penaltyPaise > 0
      ? ` | Fault Attribution: ${faultAttribution.replaceAll('_', ' ').toUpperCase()} (Penalty ₹${(penaltyPaise / 100).toFixed(2)} logged)`
      : '';

  order.statusHistory.push({
    status: nextStatus,
    changedAt: new Date(),
    actorType: 'user',
    actorId: new mongoose.Types.ObjectId(actorId),
    note:
      input.decision === 'approved'
        ? `RETURN_ACCEPTED by City Admin: ${input.reviewNote}${penaltySummaryText}`
        : `RETURN_REJECTED by City Admin: ${input.reviewNote}`,
  });

  await order.save();
  await AuditLog.create({
    actorId,
    action: `order.return_${input.decision}`,
    resourceType: 'order',
    resourceId: String(order._id),
    metadata: {
      orderReference: order.orderReference,
      faultAttribution,
      penaltyAmountPaise: penaltyPaise,
      ...(createdLedgerId ? { penaltyLedgerId: String(createdLedgerId) } : {}),
    },
  });

  sendData(res, {
    ...order.toObject(),
    sellerPickup: resolvedPickup,
  });
};

export const assignCityAdminReverseDeliveryPartner: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const { orderId } = orderParamsSchema.parse(req.params);
  const { partnerId, note } = z.object({
    partnerId: z.string().regex(/^[a-f\d]{24}$/i),
    note: z.string().trim().max(500).optional(),
  }).strict().parse(req.body);
  const actorId = authenticatedUserId(req);

  const order = await Order.findOne({ _id: orderId, 'address.city': cityFilter(city) });
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found in your assigned city.');
  if (!['return_accepted', 'return_partner_assigned'].includes(order.fulfilmentStatus) || !order.returnRequest) {
    throw new AppError(409, 'REVERSE_PARTNER_NOT_ALLOWED', 'Only approved return requests can be assigned a reverse pickup partner.');
  }

  const partner = await User.findOne({
    _id: partnerId,
    role: 'delivery_partner',
    status: 'active',
  }).select('_id name phoneE164 isOnline availabilityStatus currentLocation').lean();

  if (!partner) throw new AppError(404, 'DELIVERY_PARTNER_NOT_FOUND', 'Active delivery partner not found.');
  if (partner.isOnline === false || partner.availabilityStatus === 'offline') {
    throw new AppError(409, 'PARTNER_OFFLINE', 'Select an ONLINE & AVAILABLE delivery partner for reverse pickup.');
  }

  const resolvedPickup = await resolveOrderSellerPickup(order.toObject());
  const customerLat = order.address?.latitude ?? 23.8342;
  const customerLng = order.address?.longitude ?? 79.4385;
  const partnerLat = partner.currentLocation?.latitude ?? 23.8415;
  const partnerLng = partner.currentLocation?.longitude ?? 79.445;
  const distanceKm = haversineDistanceKm(customerLat, customerLng, partnerLat, partnerLng);

  order.fulfilmentStatus = 'return_partner_assigned';
  order.returnRequest.status = 'partner_assigned';
  order.returnRequest.reverseDeliveryPartner = {
    userId: partner._id,
    name: partner.name || 'Delivery Partner',
    phoneE164: partner.phoneE164,
    distanceKm,
    latitude: partnerLat,
    longitude: partnerLng,
    assignedAt: new Date(),
    assignedBy: new mongoose.Types.ObjectId(actorId),
  };
  order.deliveryPartner = {
    userId: partner._id,
    name: partner.name || 'Delivery Partner',
    phoneE164: partner.phoneE164,
    distanceKm,
    latitude: partnerLat,
    longitude: partnerLng,
    assignedAt: new Date(),
    assignedBy: new mongoose.Types.ObjectId(actorId),
  };

  order.statusHistory.push({
    status: 'return_partner_assigned',
    changedAt: new Date(),
    actorType: 'user',
    actorId: new mongoose.Types.ObjectId(actorId),
    note: note || `Reverse Logistics Partner (${partner.name || 'Partner'}) assigned for return pickup from Customer (${distanceKm} km away).`,
  });

  await order.save();
  await User.updateOne(
    { _id: partner._id },
    {
      $set: {
        isOnline: true,
        availabilityStatus: 'busy',
      },
    },
  );

  await AuditLog.create({
    actorId,
    action: 'order.reverse_partner_assigned',
    resourceType: 'order',
    resourceId: String(order._id),
    metadata: { orderReference: order.orderReference, partnerId: String(partner._id), distanceKm },
  });

  sendData(res, {
    ...order.toObject(),
    sellerPickup: resolvedPickup,
  });
};

export const escalateCityAdminOrderRefund: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const { orderId } = orderParamsSchema.parse(req.params);
  const { note } = z.object({ note: z.string().trim().max(500).optional() }).strict().parse(req.body ?? {});
  const actorId = authenticatedUserId(req);

  const order = await Order.findOne({ _id: orderId, 'address.city': cityFilter(city) });
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found in your assigned city.');
  if (order.fulfilmentStatus !== 'return_delivered_to_seller' || !order.returnRequest) {
    throw new AppError(409, 'REFUND_ESCALATION_NOT_ALLOWED', 'Order must be in RETURN_DELIVERED_TO_SELLER status before escalating for refund.');
  }

  order.fulfilmentStatus = 'ready_for_refund';
  order.returnRequest.status = 'ready_for_refund';
  order.returnRequest.escalatedToSuperAdminBy = new mongoose.Types.ObjectId(actorId);
  order.returnRequest.escalatedToSuperAdminAt = new Date();
  order.statusHistory.push({
    status: 'ready_for_refund',
    changedAt: new Date(),
    actorType: 'user',
    actorId: new mongoose.Types.ObjectId(actorId),
    note: note || 'City Admin verified Seller return receipt and escalated order to Super Admin as READY_FOR_REFUND.',
  });

  await order.save();
  await AuditLog.create({
    actorId,
    action: 'order.escalated_ready_for_refund',
    resourceType: 'order',
    resourceId: String(order._id),
    metadata: { orderReference: order.orderReference, city },
  });

  const resolvedPickup = await resolveOrderSellerPickup(order.toObject());
  sendData(res, {
    ...order.toObject(),
    sellerPickup: resolvedPickup,
  });
};
