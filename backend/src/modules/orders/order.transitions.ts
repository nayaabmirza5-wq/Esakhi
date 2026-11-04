export type FulfilmentStatus =
  | 'placed'
  | 'order_confirmed'
  | 'accepted'
  | 'preparing'
  | 'ready_for_pickup'
  | 'delivery_partner_assigned'
  | 'out_for_pickup'
  | 'picked_up'
  | 'out_for_delivery'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'delivery_failed'
  | 'return_requested'
  | 'return_rejected'
  | 'return_accepted'
  | 'return_partner_assigned'
  | 'return_picked_up'
  | 'return_delivered_to_seller'
  | 'ready_for_refund'
  | 'refund_completed';

export type FulfilmentMethod = 'delivery' | 'pickup';
export type PartnerAvailabilityStatus = 'available' | 'busy' | 'offline';

export function canCustomerDirectCancel(status: FulfilmentStatus): boolean {
  return (
    status === 'placed' ||
    status === 'order_confirmed' ||
    status === 'accepted' ||
    status === 'preparing'
  );
}

export function canAssignDeliveryPartner(status: FulfilmentStatus, hasAssignment: boolean): boolean {
  const assignableStatus =
    status === 'placed' ||
    status === 'order_confirmed' ||
    status === 'accepted' ||
    status === 'preparing' ||
    status === 'ready_for_pickup' ||
    status === 'delivery_partner_assigned' ||
    status === 'out_for_pickup' ||
    status === 'picked_up' ||
    status === 'out_for_delivery' ||
    status === 'delivery_failed';
  return assignableStatus && (!hasAssignment || status === 'delivery_failed');
}

export function statusAfterDeliveryPartnerAssignment(status: FulfilmentStatus): FulfilmentStatus {
  return status === 'delivery_failed' ? 'preparing' : status;
}

export function nextFulfilmentStatus(
  current: FulfilmentStatus,
  method: FulfilmentMethod,
): FulfilmentStatus | null {
  const transitions: Partial<Record<FulfilmentStatus, FulfilmentStatus>> = {
    placed: 'accepted',
    order_confirmed: 'preparing',
    accepted: 'preparing',
    preparing: method === 'pickup' ? 'ready_for_pickup' : 'out_for_delivery',
    ready_for_pickup: 'completed',
    delivery_partner_assigned: 'out_for_pickup',
    out_for_pickup: 'picked_up',
    picked_up: 'out_for_delivery',
    out_for_delivery: 'delivered',
    delivery_failed: 'delivered',
    return_requested: 'return_accepted',
    return_accepted: 'return_partner_assigned',
    return_partner_assigned: 'return_picked_up',
    return_picked_up: 'return_delivered_to_seller',
    return_delivered_to_seller: 'ready_for_refund',
    ready_for_refund: 'refund_completed',
  };
  return transitions[current] ?? null;
}

export function canPartnerTransitionOrder(
  current: FulfilmentStatus,
  target: FulfilmentStatus,
): boolean {
  if (target === 'out_for_pickup') {
    return (
      current === 'delivery_partner_assigned' ||
      current === 'ready_for_pickup' ||
      current === 'preparing'
    );
  }
  if (target === 'picked_up') {
    return (
      current === 'out_for_pickup' ||
      current === 'delivery_partner_assigned' ||
      current === 'ready_for_pickup'
    );
  }
  if (target === 'out_for_delivery') {
    return (
      current === 'picked_up' ||
      current === 'out_for_pickup' ||
      current === 'delivery_partner_assigned' ||
      current === 'ready_for_pickup' ||
      current === 'preparing'
    );
  }
  if (target === 'delivered' || target === 'delivery_failed') {
    return current === 'out_for_delivery' || current === 'picked_up';
  }
  if (target === 'return_picked_up') {
    return current === 'return_partner_assigned' || current === 'return_accepted';
  }
  if (target === 'return_delivered_to_seller') {
    return current === 'return_picked_up' || current === 'return_partner_assigned';
  }
  return false;
}

export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}
