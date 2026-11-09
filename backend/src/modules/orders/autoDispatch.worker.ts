import mongoose from 'mongoose';
import { Order } from './order.model.js';
import { User } from '../auth/user.model.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { PenaltyLedger } from './penaltyLedger.model.js';
import { logger } from '../../utils/logger.js';

const SLA_BREACH_THRESHOLD_MS = 25 * 60 * 1000; // 25 minutes
const SLA_CRITICAL_AUTO_UNASSIGN_MS = 35 * 60 * 1000; // 35 minutes

export async function autoDispatchPendingOrders(): Promise<number> {
  const unassignedOrders = await Order.find({
    fulfilmentMethod: 'delivery',
    fulfilmentStatus: { $in: ['ready_for_pickup', 'delivery_failed'] },
    $or: [
      { deliveryPartner: { $exists: false } },
      { deliveryPartner: null },
      { 'deliveryPartner.userId': { $exists: false } },
      { 'deliveryPartner.userId': null },
    ],
    deliveryStatus: { $in: ['UNASSIGNED', 'DELIVERY_FAILED'] },
  }).sort({ createdAt: 1 }).limit(20);

  if (!unassignedOrders.length) return 0;

  const availablePartners = await User.find({
    role: 'delivery_partner',
    status: 'active',
    isOnline: true,
    availabilityStatus: { $in: ['available', 'busy'] },
  }).select('_id name phoneE164 assignedCity serviceableLocalities availabilityStatus').lean();

  if (!availablePartners.length) return 0;

  let dispatchedCount = 0;

  for (const order of unassignedOrders) {
    const orderDoc = order as any;
    const orderCity = (orderDoc.address?.city || 'Damoh').toString().trim().toLowerCase();
    const cityEligiblePartners = availablePartners.filter((p) => {
      const pCity = (p.assignedCity || 'Damoh').toString().trim().toLowerCase();
      return pCity === orderCity || pCity === 'damoh';
    });

    if (!cityEligiblePartners.length) continue;

    const partnerIds = cityEligiblePartners.map((p) => p._id);
    const workloads = await Order.aggregate([
      {
        $match: {
          'deliveryPartner.userId': { $in: partnerIds },
          fulfilmentStatus: { $in: ['delivery_partner_assigned', 'out_for_pickup', 'picked_up', 'out_for_delivery'] },
        },
      },
      { $group: { _id: '$deliveryPartner.userId', count: { $sum: 1 } } },
    ]);

    const workloadMap = new Map<string, number>(workloads.map((w) => [String(w._id), Number(w.count) || 0]));

    const sorted = [...cityEligiblePartners].sort((a, b) => {
      const loadA = workloadMap.get(String(a._id)) ?? 0;
      const loadB = workloadMap.get(String(b._id)) ?? 0;
      return loadA - loadB;
    });

    const chosenPartner = sorted[0];
    if (!chosenPartner) continue;

    const currentLoad = workloadMap.get(String(chosenPartner._id)) ?? 0;
    if (currentLoad >= 4) continue; // max capacity

    // Condition 1: Check Floating Cash Threshold (> ₹2,000) for COD orders
    if (orderDoc.paymentMethod === 'cash') {
      const partnerCashOrders = await Order.find({
        'deliveryPartner.userId': chosenPartner._id,
        fulfilmentStatus: { $in: ['delivered', 'completed'] },
        $or: [{ paymentMethod: 'cash' }, { 'doorstepPayment.mode': 'cash' }],
        'doorstepPayment.remittedToCityAdmin': { $ne: true },
      }).select('totalPaise').lean();
      const unremittedCashPaise = partnerCashOrders.reduce((sum, o) => sum + (o.totalPaise || 0), 0);
      if (unremittedCashPaise > 200000) {
        logger.warn(`AutoDispatch: Delivery partner ${chosenPartner.name} holds ₹${(unremittedCashPaise / 100).toFixed(2)} in unremitted cash (> ₹2,000 threshold). Skipping COD order assignment until cash is remitted to Hub.`);
        continue;
      }
    }

    const cityAdmin = await User.findOne({
      role: { $in: ['city_admin', 'super_admin', 'admin'] },
      $or: [{ assignedCity: new RegExp(orderCity, 'i') }, { role: 'super_admin' }, { role: 'admin' }],
    }).select('_id').lean();
    const assignedByActorId = (cityAdmin?._id || chosenPartner._id) as unknown as mongoose.Types.ObjectId;

    const assignedAt = new Date();
    orderDoc.deliveryPartner = {
      userId: chosenPartner._id,
      name: chosenPartner.name || `Partner ${chosenPartner.phoneE164.slice(-4)}`,
      phoneE164: chosenPartner.phoneE164,
      distanceKm: 1.2,
      assignedAt,
      assignedBy: assignedByActorId,
    };
    orderDoc.fulfilmentStatus = 'delivery_partner_assigned';
    orderDoc.deliveryStatus = 'ASSIGNED';
    orderDoc.statusHistory.push({
      status: 'delivery_partner_assigned',
      changedAt: assignedAt,
      actorType: 'system',
      note: `Automated Smart Dispatch: Assigned to on-duty delivery partner ${orderDoc.deliveryPartner.name} (Load: ${currentLoad + 1}/4).`,
    });

    await orderDoc.save();
    dispatchedCount += 1;

    try {
      await AuditLog.create([{
        actorType: 'system',
        action: 'order.auto_dispatched',
        resourceType: 'order',
        resourceId: String(orderDoc._id),
        metadata: {
          orderReference: orderDoc.orderReference,
          assignedPartnerId: String(chosenPartner._id),
          assignedPartnerName: chosenPartner.name,
        },
      }]);
    } catch {
      // audit log failure non-blocking
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
          await PenaltyLedger.create([{
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
          }]).catch(() => null);
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

      await AuditLog.create([{
        actorType: 'system',
        action: 'order.sla_auto_unassigned',
        resourceType: 'order',
        resourceId: String(orderDoc._id),
        metadata: {
          orderReference: orderDoc.orderReference,
          unassignedPartnerId: formerPartnerId ? String(formerPartnerId) : null,
          elapsedMinutes: Math.round(elapsed / 60000),
        },
      }]).catch(() => null);
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
