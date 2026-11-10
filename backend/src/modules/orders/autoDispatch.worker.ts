import mongoose from 'mongoose';
import { Order } from './order.model.js';
import { User } from '../auth/user.model.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { PenaltyLedger } from './penaltyLedger.model.js';
import { logger } from '../../utils/logger.js';
import { haversineDistanceKm } from './order.transitions.js';
import { resolveOrderSellerPickup } from './order.controller.js';

const SLA_BREACH_THRESHOLD_MS = 25 * 60 * 1000; // 25 minutes
const SLA_CRITICAL_AUTO_UNASSIGN_MS = 35 * 60 * 1000; // 35 minutes

/**
 * Autonomous Smart Dispatch:
 * Finds the best on-duty delivery partner who is free and nearest to the pickup location.
 * Handles both Forward Deliveries (ready_for_pickup) and Reverse Pickups (return_accepted).
 */
export async function autoAssignBestPartnerForOrder(order: any): Promise<boolean> {
  const isReturn =
    order.fulfilmentStatus === 'return_accepted' ||
    Boolean(order.returnRequest && (order.returnRequest.status === 'accepted' || order.returnRequest.status === 'requested'));
  const isForward = [
    'ready_for_pickup',
    'delivery_failed',
    'placed',
    'order_confirmed',
    'accepted',
    'preparing',
  ].includes(order.fulfilmentStatus);

  if (!isReturn && !isForward) return false;

  // 1. Determine pickup coordinates
  let pickupLat = 23.8388;
  let pickupLng = 79.4422;

  if (isReturn) {
    // Reverse logistics: Agent picks up from Customer address
    pickupLat = order.address?.latitude ?? 23.8342;
    pickupLng = order.address?.longitude ?? 79.4385;
  } else {
    // Forward logistics: Agent picks up from Seller address
    try {
      const sellerPickup = await resolveOrderSellerPickup(order.toObject ? order.toObject() : order);
      pickupLat = sellerPickup.latitude ?? 23.8388;
      pickupLng = sellerPickup.longitude ?? 79.4422;
    } catch {
      pickupLat = order.sellerPickup?.latitude ?? 23.8388;
      pickupLng = order.sellerPickup?.longitude ?? 79.4422;
    }
  }

  // 2. Query all on-duty / active delivery partners
  const orderCity = (order.address?.city || 'Damoh').toString().trim().toLowerCase();
  const availablePartners = await User.find({
    role: 'delivery_partner',
    status: 'active',
    isOnline: true,
    availabilityStatus: { $in: ['available', 'busy'] },
  })
    .select('_id name phoneE164 assignedCity serviceableLocalities availabilityStatus currentLocation')
    .lean();

  if (!availablePartners.length) {
    logger.warn(`AutoDispatch: No online delivery partners found for order #${order.orderReference}.`);
    return false;
  }

  // City-eligible filter
  let cityEligiblePartners = availablePartners.filter((p) => {
    const pCity = (p.assignedCity || 'Damoh').toString().trim().toLowerCase();
    return pCity === orderCity || pCity === 'damoh';
  });

  if (!cityEligiblePartners.length) {
    cityEligiblePartners = availablePartners;
  }

  const partnerIds = cityEligiblePartners.map((p) => p._id);

  // 3. Aggregate active workloads
  const workloads = await Order.aggregate([
    {
      $match: {
        $or: [
          { 'deliveryPartner.userId': { $in: partnerIds } },
          { 'returnRequest.reverseDeliveryPartner.userId': { $in: partnerIds } },
        ],
        fulfilmentStatus: {
          $in: [
            'delivery_partner_assigned',
            'out_for_pickup',
            'picked_up',
            'out_for_delivery',
            'return_partner_assigned',
            'return_picked_up',
          ],
        },
      },
    },
    { $group: { _id: '$deliveryPartner.userId', count: { $sum: 1 } } },
  ]);

  const workloadMap = new Map<string, number>(workloads.map((w) => [String(w._id), Number(w.count) || 0]));

  // 4. Score candidates: (Distance Km * 1.0) + (Workload * 2.5) + (Busy Penalty: 3)
  type CandidateScore = {
    partner: (typeof cityEligiblePartners)[0];
    distanceKm: number;
    currentLoad: number;
    score: number;
  };

  const candidates: CandidateScore[] = [];

  for (const partner of cityEligiblePartners) {
    const currentLoad = workloadMap.get(String(partner._id)) ?? 0;
    if (currentLoad >= 4) continue; // Max concurrent capacity

    // COD Safety Check: Skip if rider holds > ₹2,000 in unremitted cash
    if (order.paymentMethod === 'cash') {
      const partnerCashOrders = await Order.find({
        'deliveryPartner.userId': partner._id,
        fulfilmentStatus: { $in: ['delivered', 'completed'] },
        $or: [{ paymentMethod: 'cash' }, { 'doorstepPayment.mode': 'cash' }],
        'doorstepPayment.remittedToCityAdmin': { $ne: true },
      })
        .select('totalPaise')
        .lean();
      const unremittedCashPaise = partnerCashOrders.reduce((sum, o) => sum + (o.totalPaise || 0), 0);
      if (unremittedCashPaise > 200000) {
        continue;
      }
    }

    const pLat = partner.currentLocation?.latitude ?? 23.8415;
    const pLng = partner.currentLocation?.longitude ?? 79.445;
    const distanceKm = haversineDistanceKm(pickupLat, pickupLng, pLat, pLng) ?? 1.2;

    const busyPenalty = partner.availabilityStatus === 'busy' ? 3.0 : 0.0;
    const score = distanceKm * 1.0 + currentLoad * 2.5 + busyPenalty;

    candidates.push({ partner, distanceKm, currentLoad, score });
  }

  if (!candidates.length) {
    logger.warn(`AutoDispatch: All candidates are at full capacity or offline for order #${order.orderReference}.`);
    return false;
  }

  // Sort ascending by composite score (lowest score = closest + freest agent)
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];
  if (!best) return false;
  const chosenPartner = best.partner;

  // Resolve assignedBy actor
  const cityAdmin = await User.findOne({
    role: { $in: ['city_admin', 'super_admin', 'admin'] },
    $or: [{ assignedCity: new RegExp(orderCity, 'i') }, { role: 'super_admin' }, { role: 'admin' }],
  })
    .select('_id')
    .lean();
  const assignedByActorId = (cityAdmin?._id || chosenPartner._id) as unknown as mongoose.Types.ObjectId;
  const assignedAt = new Date();

  const partnerPayload = {
    userId: chosenPartner._id,
    name: chosenPartner.name || `Partner ${chosenPartner.phoneE164.slice(-4)}`,
    phoneE164: chosenPartner.phoneE164,
    distanceKm: best.distanceKm,
    latitude: chosenPartner.currentLocation?.latitude ?? 23.8415,
    longitude: chosenPartner.currentLocation?.longitude ?? 79.445,
    assignedAt,
    assignedBy: assignedByActorId,
  };

  order.deliveryPartner = partnerPayload;
  order.deliveryStatus = 'ASSIGNED';

  if (isReturn) {
    order.fulfilmentStatus = 'return_partner_assigned';
    if (!order.returnRequest) {
      order.returnRequest = { status: 'partner_assigned' } as any;
    } else {
      order.returnRequest.status = 'partner_assigned';
    }
    order.returnRequest.reverseDeliveryPartner = partnerPayload;
    order.statusHistory.push({
      status: 'return_partner_assigned',
      changedAt: assignedAt,
      actorType: 'system',
      note: `Autonomous Reverse Dispatch: Nearest available delivery partner ${chosenPartner.name} (${chosenPartner.phoneE164}) auto-assigned (${best.distanceKm.toFixed(1)} km away, load: ${best.currentLoad + 1}/4) for reverse pickup.`,
    });
  } else {
    order.fulfilmentStatus = 'delivery_partner_assigned';
    order.statusHistory.push({
      status: 'delivery_partner_assigned',
      changedAt: assignedAt,
      actorType: 'system',
      note: `Autonomous Smart Dispatch: Assigned to nearest on-duty delivery partner ${chosenPartner.name} (${chosenPartner.phoneE164}) (${best.distanceKm.toFixed(1)} km away, load: ${best.currentLoad + 1}/4).`,
    });
  }

  await order.save();
  logger.info(
    `AutoDispatch: Successfully assigned order #${order.orderReference} (${isReturn ? 'Reverse' : 'Forward'}) to ${chosenPartner.name} (${chosenPartner.phoneE164})`,
  );

  try {
    await AuditLog.create([
      {
        actorType: 'system',
        action: isReturn ? 'order.return_partner_auto_assigned' : 'order.auto_dispatched',
        resourceType: 'order',
        resourceId: String(order._id),
        metadata: {
          orderReference: order.orderReference,
          assignedPartnerId: String(chosenPartner._id),
          assignedPartnerName: chosenPartner.name,
          distanceKm: best.distanceKm,
          isReturn,
        },
      },
    ]);
  } catch {
    // Non-blocking audit log
  }

  return true;
}

/**
 * On-demand auto-assignment for a single order by ID
 */
export async function autoAssignOrderById(orderId: string | mongoose.Types.ObjectId): Promise<boolean> {
  const order = await Order.findById(orderId);
  if (!order) return false;
  return autoAssignBestPartnerForOrder(order);
}

/**
 * Periodic dispatch scan for all pending forward and reverse orders
 */
export async function autoDispatchPendingOrders(): Promise<number> {
  const unassignedOrders = await Order.find({
    $or: [
      {
        fulfilmentMethod: 'delivery',
        fulfilmentStatus: { $in: ['ready_for_pickup', 'delivery_failed'] },
        $or: [
          { deliveryPartner: { $exists: false } },
          { deliveryPartner: null },
          { 'deliveryPartner.userId': { $exists: false } },
          { 'deliveryPartner.userId': null },
        ],
      },
      {
        fulfilmentStatus: 'return_accepted',
      },
    ],
  })
    .sort({ createdAt: 1 })
    .limit(25);

  if (!unassignedOrders.length) return 0;

  let dispatchedCount = 0;
  for (const order of unassignedOrders) {
    try {
      const assigned = await autoAssignBestPartnerForOrder(order);
      if (assigned) dispatchedCount += 1;
    } catch (err) {
      logger.error('AutoDispatch order error', {
        orderId: String(order._id),
        error: String(err),
      });
    }
  }

  if (dispatchedCount > 0) {
    logger.info(`Automated Smart Dispatch: Dispatched ${dispatchedCount} orders to active delivery partners.`);
  }

  return dispatchedCount;
}

export async function monitorSlaAndAutoEscalate(): Promise<number> {
  const activeOrders = await Order.find({
    fulfilmentMethod: 'delivery',
    fulfilmentStatus: { $in: ['delivery_partner_assigned', 'out_for_pickup', 'picked_up', 'out_for_delivery'] },
    'deliveryPartner.assignedAt': { $exists: true },
  });

  if (!activeOrders.length) return 0;

  const now = Date.now();
  let escalatedCount = 0;

  for (const order of activeOrders) {
    const orderDoc = order as any;
    const assignedTime = orderDoc.deliveryPartner?.assignedAt
      ? new Date(orderDoc.deliveryPartner.assignedAt).getTime()
      : new Date(orderDoc.createdAt).getTime();

    const elapsed = now - assignedTime;

    if (elapsed > SLA_CRITICAL_AUTO_UNASSIGN_MS) {
      const formerPartnerId = orderDoc.deliveryPartner?.userId;
      const formerPartnerName = orderDoc.deliveryPartner?.name || 'Rider';

      if (formerPartnerId) {
        const existingPenalty = await PenaltyLedger.findOne({
          orderId: orderDoc._id,
          partyId: formerPartnerId,
        });
        if (!existingPenalty) {
          await PenaltyLedger.create([
            {
              orderId: orderDoc._id,
              orderReference: orderDoc.orderReference,
              city: orderDoc.address?.city || 'Damoh',
              partyType: 'delivery_partner',
              partyId: formerPartnerId,
              partyName: formerPartnerName,
              penaltyAmountPaise: 5000,
              reason: `Automated SLA Breach Penalty: Order ${orderDoc.orderReference} exceeded 35-minute SLA with no delivery progress.`,
              faultType: 'delivery_partner_fault',
              cityAdminId: formerPartnerId,
              settlementStatus: 'DELIVERY_PARTNER_PENALTY_PENDING',
            },
          ]).catch(() => null);
        }
      }

      orderDoc.deliveryPartner = null;
      orderDoc.deliveryStatus = 'UNASSIGNED';
      orderDoc.fulfilmentStatus = 'ready_for_pickup';
      orderDoc.statusHistory.push({
        status: 'ready_for_pickup',
        changedAt: new Date(),
        actorType: 'system',
        note: `Automated SLA Failover: Partner ${formerPartnerName} was inactive >35 min. Order auto-unassigned and returned to dispatch queue.`,
      });

      await orderDoc.save();
      escalatedCount += 1;

      await AuditLog.create([
        {
          actorType: 'system',
          action: 'order.sla_auto_unassigned',
          resourceType: 'order',
          resourceId: String(orderDoc._id),
          metadata: {
            orderReference: orderDoc.orderReference,
            unassignedPartnerId: formerPartnerId ? String(formerPartnerId) : null,
            elapsedMinutes: Math.round(elapsed / 60000),
          },
        },
      ]).catch(() => null);
    } else if (elapsed > SLA_BREACH_THRESHOLD_MS) {
      const hasWarning = orderDoc.statusHistory?.some((h: any) => h.note?.includes('SLA_BREACH_WARNING'));
      if (!hasWarning) {
        orderDoc.statusHistory.push({
          status: orderDoc.fulfilmentStatus,
          changedAt: new Date(),
          actorType: 'system',
          note: `SLA_BREACH_WARNING: In-transit duration has exceeded 25 minutes. Automated monitoring active.`,
        });
        await orderDoc.save().catch(() => null);
      }
    }
  }

  if (escalatedCount > 0) {
    logger.warn(`SLA Monitoring: Auto-unassigned ${escalatedCount} unresponsive deliveries for immediate re-dispatch.`);
    await autoDispatchPendingOrders().catch(() => null);
  }

  return escalatedCount;
}

export async function processSlaAndAutoDispatch(): Promise<void> {
  try {
    await autoDispatchPendingOrders();
    await monitorSlaAndAutoEscalate();
  } catch (error) {
    logger.error('AutoDispatch and SLA worker cycle error', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
